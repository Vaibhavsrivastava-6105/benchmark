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
                    "failure_category": FailureCategory.INVALID_JSON,
                    "reasoning": "Output missing JSON curly delimiters."
                }
            json_substring = response_text[json_start:json_end+1]
            try:
                parsed_json = json.loads(json_substring)
            except json.JSONDecodeError as jde:
                return 0.0, False, {
                    "error": f"JSON syntax error: {jde.msg}",
                    "failure_category": FailureCategory.INVALID_JSON,
                    "reasoning": f"Malformed JSON syntax: {jde.msg}"
                }
            if not schema_definition:
                return 1.0, True, {
                    "info": "Valid JSON structure.",
                    "failure_category": FailureCategory.NONE,
                    "reasoning": "Valid JSON object."
                }
            try:
                validate(instance=parsed_json, schema=schema_definition)
                return 1.0, True, {
                    "info": "JSON strictly conforms to schema.",
                    "failure_category": FailureCategory.NONE,
                    "reasoning": "Schema validation passed."
                }
            except ValidationError as ve:
                path_str = " -> ".join(str(p) for p in ve.absolute_path) or "root"
                return 0.3, False, {
                    "error": f"Schema non-compliance at '{path_str}': {ve.message}",
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
