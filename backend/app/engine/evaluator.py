import re
import json
import logging
import asyncio
from typing import Dict, Any, Optional, Tuple, List
from jsonschema import validate, ValidationError

logger = logging.getLogger(__name__)

class FailureCategory:
    NONE = "NONE"
    INVALID_JSON = "INVALID_JSON"
    WRONG_ANSWER = "WRONG_ANSWER"
    HALLUCINATION = "HALLUCINATION"
    CODE_ERROR = "CODE_ERROR"
    TIMEOUT = "TIMEOUT"
    PROVIDER_ERROR = "PROVIDER_ERROR"
    ASSERTION_FAILED = "ASSERTION_FAILED"


class ResponseEvaluator:
    @staticmethod
    def evaluate(
        evaluator_type: str,
        response_text: str,
        expected_answer: Optional[str] = None,
        schema_definition: Optional[Dict[str, Any]] = None,
        assertions: Optional[List[Dict[str, Any]]] = None
    ) -> Tuple[float, bool, Dict[str, Any]]:
        response_text = response_text.strip() if response_text else ""
        
        if not response_text:
            return 0.0, False, {
                "error": "Empty response received from inference engine.",
                "failure_category": FailureCategory.PROVIDER_ERROR,
                "reasoning": "Inference server returned 0 tokens."
            }

        if assertions and len(assertions) > 0:
            return ResponseEvaluator.evaluate_assertions(response_text, assertions)

        if evaluator_type == "exact_match":
            if not expected_answer:
                return 1.0, True, {"info": "No expected answer provided.", "failure_category": FailureCategory.NONE}
            passed = response_text.strip().lower() == expected_answer.strip().lower()
            score = 1.0 if passed else 0.0
            category = FailureCategory.NONE if passed else FailureCategory.WRONG_ANSWER
            reasoning = "Response matches ground truth." if passed else f"Expected '{expected_answer}' but received '{response_text[:100]}...'"
            return score, passed, {
                "expected": expected_answer,
                "actual": response_text,
                "failure_category": category,
                "reasoning": reasoning
            }

        elif evaluator_type == "contains":
            if not expected_answer:
                return 1.0, True, {"info": "No expected answer provided.", "failure_category": FailureCategory.NONE}
            passed = expected_answer.lower() in response_text.lower()
            score = 1.0 if passed else 0.0
            category = FailureCategory.NONE if passed else FailureCategory.WRONG_ANSWER
            reasoning = f"Found keyword '{expected_answer}'." if passed else f"Missing required keyword '{expected_answer}'."
            return score, passed, {
                "expected_substring": expected_answer,
                "found": passed,
                "failure_category": category,
                "reasoning": reasoning
            }

        elif evaluator_type == "regex":
            if not expected_answer:
                return 1.0, True, {"info": "No pattern provided.", "failure_category": FailureCategory.NONE}
            try:
                match = re.search(expected_answer, response_text, re.IGNORECASE | re.DOTALL)
                passed = match is not None
                score = 1.0 if passed else 0.0
                category = FailureCategory.NONE if passed else FailureCategory.WRONG_ANSWER
                reasoning = f"Matched pattern '{expected_answer}'." if passed else f"Failed to match pattern '{expected_answer}'."
                return score, passed, {
                    "pattern": expected_answer,
                    "matched": passed,
                    "failure_category": category,
                    "reasoning": reasoning
                }
            except Exception as e:
                return 0.0, False, {"error": str(e), "failure_category": FailureCategory.ASSERTION_FAILED, "reasoning": str(e)}

        elif evaluator_type == "numeric":
            if not expected_answer:
                return 1.0, True, {"info": "No numeric value provided.", "failure_category": FailureCategory.NONE}
            numbers = re.findall(r"[-+]?\d*\.?\d+", response_text)
            if not numbers:
                return 0.0, False, {
                    "error": "No numeric values found.",
                    "failure_category": FailureCategory.WRONG_ANSWER,
                    "reasoning": f"Expected numeric {expected_answer}, but none parsed."
                }
            try:
                actual_val = float(numbers[-1])
                expected_val = float(expected_answer)
                passed = abs(actual_val - expected_val) < 1e-4
                score = 1.0 if passed else 0.0
                category = FailureCategory.NONE if passed else FailureCategory.WRONG_ANSWER
                reasoning = f"Parsed answer {actual_val} matches {expected_val}." if passed else f"Parsed value {actual_val} does not match {expected_val}."
                return score, passed, {
                    "expected": expected_val,
                    "actual": actual_val,
                    "difference": abs(actual_val - expected_val),
                    "failure_category": category,
                    "reasoning": reasoning
                }
            except Exception as e:
                return 0.0, False, {"error": str(e), "failure_category": FailureCategory.WRONG_ANSWER, "reasoning": str(e)}

        elif evaluator_type == "json_schema":
            json_start = response_text.find("{")
            json_end = response_text.rfind("}")
            if json_start == -1 or json_end == -1:
                return 0.0, False, {
                    "error": "Could not locate JSON curly braces.",
                    "valid_json": False,
                    "malformed_json": True,
                    "schema_compliance": False,
                    "failure_category": FailureCategory.INVALID_JSON,
                    "reasoning": "Output missing JSON curly delimiters."
                }
            json_substring = response_text[json_start:json_end+1]
            try:
                parsed_json = json.loads(json_substring)
            except json.JSONDecodeError as jde:
                return 0.0, False, {
                    "error": f"JSON syntax error: {jde.msg}",
                    "valid_json": False,
                    "malformed_json": True,
                    "schema_compliance": False,
                    "failure_category": FailureCategory.INVALID_JSON,
                    "reasoning": f"Malformed JSON syntax: {jde.msg}"
                }
            if not schema_definition:
                return 1.0, True, {
                    "info": "Valid JSON structure.",
                    "valid_json": True,
                    "schema_compliance": True,
                    "failure_category": FailureCategory.NONE,
                    "reasoning": "Valid JSON object."
                }
            try:
                validate(instance=parsed_json, schema=schema_definition)
                return 1.0, True, {
                    "info": "JSON strictly conforms to schema.",
                    "valid_json": True,
                    "schema_compliance": True,
                    "failure_category": FailureCategory.NONE,
                    "reasoning": "Schema validation passed."
                }
            except ValidationError as ve:
                path_str = " -> ".join(str(p) for p in ve.absolute_path) or "root"
                return 0.5, False, {
                    "error": f"Schema non-compliance at '{path_str}': {ve.message}",
                    "valid_json": True,
                    "schema_compliance": False,
                    "failure_category": FailureCategory.INVALID_JSON,
                    "reasoning": f"Missing or invalid field at '{path_str}': {ve.message}"
                }

        elif evaluator_type == "code_test":
            code_blocks = re.findall(r"```python\s*(.*?)\s*```", response_text, re.DOTALL) or re.findall(r"```\s*(.*?)\s*```", response_text, re.DOTALL)
            if not code_blocks:
                return 0.0, False, {
                    "error": "No markdown code block found.",
                    "failure_category": FailureCategory.CODE_ERROR,
                    "reasoning": "Model failed to output code in markdown block."
                }
            code_content = code_blocks[0]
            try:
                compile(code_content, "<string>", "exec")
                return 1.0, True, {
                    "info": "Python syntax validation passed.",
                    "failure_category": FailureCategory.NONE,
                    "reasoning": "Code syntax compiles without syntax errors."
                }
            except SyntaxError as se:
                return 0.2, False, {
                    "error": f"SyntaxError: {se.msg} at line {se.lineno}",
                    "failure_category": FailureCategory.CODE_ERROR,
                    "reasoning": f"Compilation failed: {se.msg}"
                }

        elif evaluator_type == "semantic_similarity":
            if not expected_answer:
                return 1.0, True, {"info": "No reference answer provided.", "failure_category": FailureCategory.NONE}
            sim_score = _calculate_token_f1(response_text, expected_answer)
            passed = sim_score >= 0.70
            category = FailureCategory.NONE if passed else FailureCategory.WRONG_ANSWER
            reasoning = f"Token overlap score {sim_score:.2f} >= 0.70." if passed else f"Token overlap score {sim_score:.2f} < 0.70."
            return sim_score, passed, {
                "similarity_score": round(sim_score, 3),
                "expected": expected_answer,
                "actual": response_text,
                "failure_category": category,
                "reasoning": reasoning
            }

        elif evaluator_type == "instruction_following":
            # Evaluates structural and negative constraints (word limits, bullet counts, forbidden words)
            checks_passed = 0
            total_checks = 0
            reasons = []

            # 1. Length constraint checks
            if schema_definition and "max_words" in schema_definition:
                total_checks += 1
                word_count = len(response_text.split())
                max_w = schema_definition["max_words"]
                if word_count <= max_w:
                    checks_passed += 1
                else:
                    reasons.append(f"Exceeded word limit ({word_count} > {max_w})")

            if schema_definition and "min_words" in schema_definition:
                total_checks += 1
                word_count = len(response_text.split())
                min_w = schema_definition["min_words"]
                if word_count >= min_w:
                    checks_passed += 1
                else:
                    reasons.append(f"Under word limit ({word_count} < {min_w})")

            # 2. Forbidden words / Negative constraints
            if schema_definition and "forbidden_words" in schema_definition:
                for fw in schema_definition["forbidden_words"]:
                    total_checks += 1
                    if fw.lower() not in response_text.lower():
                        checks_passed += 1
                    else:
                        reasons.append(f"Contains forbidden word '{fw}'")

            # 3. Required formatting (e.g. bullet points or numbered list)
            if schema_definition and schema_definition.get("require_bullets"):
                total_checks += 1
                bullets = [line for line in response_text.split("\n") if line.strip().startswith(("-", "*", "•"))]
                expected_bullets = schema_definition.get("bullet_count")
                if expected_bullets:
                    if len(bullets) == expected_bullets:
                        checks_passed += 1
                    else:
                        reasons.append(f"Expected {expected_bullets} bullets, found {len(bullets)}")
                elif len(bullets) > 0:
                    checks_passed += 1
                else:
                    reasons.append("Missing required bulleted formatting")

            # Fallback if no schema constraints: check expected answer presence
            if total_checks == 0:
                if expected_answer:
                    total_checks = 1
                    if expected_answer.lower() in response_text.lower():
                        checks_passed = 1
                    else:
                        reasons.append(f"Missing expected instruction target '{expected_answer}'")
                else:
                    total_checks = 1
                    checks_passed = 1 if len(response_text) > 10 else 0

            score = round(checks_passed / total_checks, 2)
            passed = score >= 0.80
            category = FailureCategory.NONE if passed else FailureCategory.WRONG_ANSWER
            reasoning = "All instruction constraints satisfied." if passed else "; ".join(reasons)
            return score, passed, {
                "instruction_following_score": score,
                "checks_passed": checks_passed,
                "total_checks": total_checks,
                "reasons": reasons,
                "failure_category": category,
                "reasoning": reasoning
            }

        elif evaluator_type == "reasoning_quality":
            # Step-by-step logic and chain-of-thought analysis
            steps = re.findall(r"(?:step\s*\d+|firstly|secondly|therefore|because|thus|hence|in conclusion)", response_text, re.IGNORECASE)
            has_conclusion = bool(re.search(r"(?:conclusion|therefore|final answer|thus|summary)", response_text, re.IGNORECASE))
            has_step_structure = len(steps) >= 2 or "\n" in response_text

            reasoning_score = 0.0
            if has_step_structure:
                reasoning_score += 0.40
            if len(steps) >= 2:
                reasoning_score += 0.30
            if has_conclusion:
                reasoning_score += 0.30

            # If expected answer provided, check that final conclusion matches expected
            if expected_answer:
                if expected_answer.lower() in response_text.lower():
                    reasoning_score = min(1.0, reasoning_score + 0.20)
                else:
                    reasoning_score = max(0.0, reasoning_score - 0.30)

            reasoning_score = round(min(1.0, reasoning_score), 2)
            passed = reasoning_score >= 0.60
            category = FailureCategory.NONE if passed else FailureCategory.WRONG_ANSWER
            return reasoning_score, passed, {
                "reasoning_score": reasoning_score,
                "step_markers_found": len(steps),
                "has_conclusion": has_conclusion,
                "failure_category": category,
                "reasoning": f"Chain-of-thought quality score: {reasoning_score} (steps: {len(steps)}, conclusion: {has_conclusion})"
            }

        elif evaluator_type == "hallucination_detector":
            # Factuality & unsupported assertion checking against reference
            if not expected_answer:
                return 1.0, True, {"info": "No ground truth reference for hallucination check.", "failure_category": FailureCategory.NONE}
            
            # Check for direct contradictions or fabricated numbers
            expected_numbers = set(re.findall(r"\b\d+\.?\d*\b", expected_answer))
            actual_numbers = set(re.findall(r"\b\d+\.?\d*\b", response_text))
            phantom_numbers = actual_numbers - expected_numbers
            
            overlap_score = _calculate_token_f1(response_text, expected_answer)
            is_hallucinated = (len(phantom_numbers) > 3 and overlap_score < 0.40) or (overlap_score < 0.25)
            score = 0.0 if is_hallucinated else round(overlap_score, 2)
            passed = not is_hallucinated
            category = FailureCategory.HALLUCINATION if is_hallucinated else FailureCategory.NONE
            return score, passed, {
                "hallucination_detected": is_hallucinated,
                "factual_overlap": round(overlap_score, 3),
                "phantom_numbers": list(phantom_numbers)[:5],
                "failure_category": category,
                "reasoning": "Potential hallucination detected: output diverges significantly from verified reference facts." if is_hallucinated else "Factual consistency verified."
            }

        else:
            return 1.0, True, {"info": f"Assumed pass for {evaluator_type}", "failure_category": FailureCategory.NONE}

    @staticmethod
    def evaluate_assertions(response_text: str, assertions: List[Dict[str, Any]]) -> Tuple[float, bool, Dict[str, Any]]:
        results = []
        all_passed = True
        total_score = 0.0
        for a in assertions:
            a_type = a.get("type", "contains")
            a_val = a.get("value")
            a_schema = a.get("schema")
            score, passed, details = ResponseEvaluator.evaluate(
                evaluator_type=a_type,
                response_text=response_text,
                expected_answer=a_val,
                schema_definition=a_schema
            )
            if not passed:
                all_passed = False
            total_score += score
            results.append({"assertion_type": a_type, "passed": passed, "score": score, "details": details})
        avg_score = round(total_score / len(assertions), 2) if assertions else 1.0
        return avg_score, all_passed, {
            "assertion_results": results,
            "passed_count": sum(1 for r in results if r["passed"]),
            "total_assertions": len(assertions),
            "failure_category": FailureCategory.NONE if all_passed else FailureCategory.ASSERTION_FAILED,
            "reasoning": f"Passed {sum(1 for r in results if r['passed'])}/{len(assertions)} assertions."
        }

    @staticmethod
    async def evaluate_llm_judge(
        response_text: str,
        prompt_text: str,
        expected_answer: Optional[str],
        judge_provider_client,
        judge_model_name: str
    ) -> Tuple[float, bool, Dict[str, Any]]:
        judge_system = (
            "You are an expert AI evaluator judging the output of an LLM.\n"
            "Evaluate the response on: 1) Factual Correctness, 2) Instruction Following, 3) Hallucination Freedom.\n"
            "Output strictly valid JSON with:\n"
            "- 'score': float between 0.0 and 1.0\n"
            "- 'reasoning': concise 1-2 sentence explanation\n"
            "- 'is_hallucinated': boolean\n"
            "- 'failure_category': one of ['NONE', 'WRONG_ANSWER', 'HALLUCINATION', 'INVALID_JSON']\n"
        )
        judge_user = (
            f"Prompt: \"{prompt_text}\"\n\n"
            f"Expected Reference: \"{expected_answer or 'None'}\"\n\n"
            f"Model Response: \"{response_text}\"\n\n"
            "Evaluate and return strictly the JSON object."
        )
        try:
            result = await judge_provider_client.generate(
                model=judge_model_name,
                prompt=judge_user,
                system_prompt=judge_system,
                options={"temperature": 0.0, "max_tokens": 256}
            )
            if result.error:
                return 0.0, False, {
                    "error": f"Judge error: {result.error}",
                    "failure_category": FailureCategory.PROVIDER_ERROR,
                    "reasoning": f"Judge provider returned error: {result.error}"
                }
            text = result.text.strip()
            json_start = text.find("{")
            json_end = text.rfind("}")
            if json_start != -1 and json_end != -1:
                text = text[json_start:json_end+1]
            data = json.loads(text)
            score = float(data.get("score", 0.0))
            reasoning = data.get("reasoning", "Evaluated.")
            is_hallucinated = bool(data.get("is_hallucinated", False))
            category = data.get("failure_category", FailureCategory.NONE if score >= 0.70 else FailureCategory.WRONG_ANSWER)
            if is_hallucinated:
                category = FailureCategory.HALLUCINATION
            passed = score >= 0.70
            return score, passed, {
                "judge_model": judge_model_name,
                "judge_provider": judge_provider_client.name,
                "score": score,
                "reasoning": reasoning,
                "is_hallucinated": is_hallucinated,
                "failure_category": category if not passed else FailureCategory.NONE
            }
        except Exception as e:
            return 0.0, False, {
                "error": str(e),
                "failure_category": FailureCategory.PROVIDER_ERROR,
                "reasoning": str(e)
            }


def _calculate_token_f1(actual: str, expected: str) -> float:
    actual_tokens = set(re.findall(r"\w+", actual.lower()))
    expected_tokens = set(re.findall(r"\w+", expected.lower()))
    if not actual_tokens or not expected_tokens:
        return 1.0 if actual.strip() == expected.strip() else 0.0
    common = actual_tokens.intersection(expected_tokens)
    if not common:
        return 0.0
    precision = len(common) / len(actual_tokens)
    recall = len(common) / len(expected_tokens)
    return (2 * precision * recall) / (precision + recall)


import math
import statistics

def calculate_percentiles(values: List[float]) -> Dict[str, float]:
    """
    Computes mean, standard deviation, P50, P90, P95, P99 for a list of latency values.
    """
    if not values:
        return {
            "mean": 0.0,
            "std_dev": 0.0,
            "p50": 0.0,
            "p90": 0.0,
            "p95": 0.0,
            "p99": 0.0
        }
    
    sorted_vals = sorted(values)
    n = len(sorted_vals)
    mean_val = sum(sorted_vals) / n
    std_val = statistics.stdev(sorted_vals) if n > 1 else 0.0

    def get_p(p: float) -> float:
        k = (n - 1) * (p / 100.0)
        f = math.floor(k)
        c = math.ceil(k)
        if f == c:
            return sorted_vals[int(k)]
        d0 = sorted_vals[int(f)] * (c - k)
        d1 = sorted_vals[int(c)] * (k - f)
        return d0 + d1

    return {
        "mean": round(mean_val, 2),
        "std_dev": round(std_val, 2),
        "p50": round(get_p(50), 2),
        "p90": round(get_p(90), 2),
        "p95": round(get_p(95), 2),
        "p99": round(get_p(99), 2)
    }

def evaluate_consistency(repetitions_responses: List[str]) -> Tuple[float, Dict[str, Any]]:
    """
    Measures semantic and lexical consistency across multiple repetition runs of the same prompt.
    """
    if not repetitions_responses or len(repetitions_responses) < 2:
        return 1.0, {"info": "Single repetition run (consistency 100%)."}

    pair_scores = []
    for i in range(len(repetitions_responses)):
        for j in range(i + 1, len(repetitions_responses)):
            score = _calculate_token_f1(repetitions_responses[i], repetitions_responses[j])
            pair_scores.append(score)

    avg_consistency = sum(pair_scores) / len(pair_scores) if pair_scores else 1.0
    return round(avg_consistency, 3), {
        "pairwise_consistency_mean": round(avg_consistency, 3),
        "repetitions_count": len(repetitions_responses),
        "is_consistent": avg_consistency >= 0.75
    }

def calculate_cost_and_energy(
    prompt_tokens: int,
    output_tokens: int,
    duration_seconds: float,
    telemetry_samples: List[Any],
    cost_input_per_1k: float = 0.0,
    cost_output_per_1k: float = 0.0,
    electricity_cost_kwh: float = 0.12
) -> Dict[str, float]:
    """
    Calculates cloud token costs and local hardware electricity cost based on live NVML wattage telemetry.
    """
    token_cost = ((prompt_tokens / 1000.0) * cost_input_per_1k) + ((output_tokens / 1000.0) * cost_output_per_1k)
    total_tokens = prompt_tokens + output_tokens
    cost_per_1k = (token_cost / (total_tokens / 1000.0)) if total_tokens > 0 else 0.0
    cost_per_1m = cost_per_1k * 1000.0

    # Extract average GPU power watts from telemetry samples
    power_samples = []
    for s in telemetry_samples:
        gpu_info = s.get("gpu_utilization") if isinstance(s, dict) else getattr(s, "gpu_utilization", None)
        if isinstance(gpu_info, list):
            for g in gpu_info:
                if isinstance(g, dict) and "power_watts" in g:
                    power_samples.append(float(g["power_watts"]))

    avg_power_watts = (sum(power_samples) / len(power_samples)) if power_samples else 35.0  # Default ~35W
    # Energy in kWh = (Watts * (seconds / 3600)) / 1000
    energy_kwh = (avg_power_watts * (duration_seconds / 3600.0)) / 1000.0
    energy_cost_usd = energy_kwh * electricity_cost_kwh

    total_cost = round(token_cost + energy_cost_usd, 6)

    return {
        "token_cost_usd": round(token_cost, 6),
        "total_cost_usd": total_cost,
        "cost_per_1k_tokens": round(cost_per_1k, 6),
        "cost_per_1m_tokens": round(cost_per_1m, 6),
        "energy_consumption_kwh": round(energy_kwh, 6),
        "energy_cost_usd": round(energy_cost_usd, 6),
        "avg_power_watts": round(avg_power_watts, 2)
    }
