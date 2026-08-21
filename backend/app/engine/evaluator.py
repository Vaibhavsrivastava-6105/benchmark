import re
import json
import logging
import asyncio
from typing import Dict, Any, Optional, Tuple
from jsonschema import validate, ValidationError

logger = logging.getLogger(__name__)

class ResponseEvaluator:
    @staticmethod
    def evaluate(
        evaluator_type: str,
        response_text: str,
        expected_answer: Optional[str] = None,
        schema_definition: Optional[Dict[str, Any]] = None,
        judge_client_callback = None  # Async callback to call judge LLM if needed
    ) -> Tuple[float, bool, Dict[str, Any]]:
        """
        Evaluates the response.
        Returns: (score, passed, details_dict)
        """
        response_text = response_text.strip() if response_text else ""
        
        # 1. Exact Match
        if evaluator_type == "exact_match":
            if not expected_answer:
                return 1.0, True, {"info": "No expected answer provided, defaults to pass."}
            passed = response_text.strip() == expected_answer.strip()
            score = 1.0 if passed else 0.0
            return score, passed, {"expected": expected_answer, "actual": response_text}

        # 2. Contains
        elif evaluator_type == "contains":
            if not expected_answer:
                return 1.0, True, {"info": "No expected answer provided, defaults to pass."}
            passed = expected_answer.lower() in response_text.lower()
            score = 1.0 if passed else 0.0
            return score, passed, {"expected_substring": expected_answer, "found": passed}

        # 3. Regex
        elif evaluator_type == "regex":
            if not expected_answer:
                return 1.0, True, {"info": "No regex pattern provided, defaults to pass."}
            try:
                match = re.search(expected_answer, response_text, re.IGNORECASE | re.DOTALL)
                passed = match is not None
                score = 1.0 if passed else 0.0
                return score, passed, {"pattern": expected_answer, "matched": passed}
            except Exception as e:
                return 0.0, False, {"error": f"Invalid regex pattern: {str(e)}"}

        # 4. Numeric
        elif evaluator_type == "numeric":
            if not expected_answer:
                return 1.0, True, {"info": "No expected numeric value provided, defaults to pass."}
            
            # Find first float or number in response
            numbers = re.findall(r"[-+]?\d*\.\d+|\d+", response_text)
            if not numbers:
                return 0.0, False, {"error": "No numbers found in response text."}
            
            try:
                actual_val = float(numbers[-1])
                expected_val = float(expected_answer)
                passed = abs(actual_val - expected_val) < 1e-5
                score = 1.0 if passed else 0.0
                return score, passed, {"expected": expected_val, "actual": actual_val, "difference": abs(actual_val - expected_val)}
            except Exception as e:
                return 0.0, False, {"error": f"Failed numeric parse: {str(e)}"}

        # 5. JSON Schema Validation
        elif evaluator_type == "json_schema":
            metrics = {
                "valid_json": False,
                "schema_compliance": False,
                "malformed_json": False,
                "extra_text": False,
            }
            
            # Check if there is extra text outside JSON
            json_start = response_text.find("{")
            json_end = response_text.rfind("}")
            
            if json_start == -1 or json_end == -1:
                metrics["malformed_json"] = True
                return 0.0, False, {"error": "Could not locate JSON curly braces.", **metrics}
            
            if json_start > 0 or json_end < len(response_text) - 1:
                metrics["extra_text"] = True

            json_substring = response_text[json_start:json_end+1]
            try:
                parsed_json = json.loads(json_substring)
                metrics["valid_json"] = True
            except json.JSONDecodeError as jde:
                metrics["malformed_json"] = True
                return 0.0, False, {"error": f"JSON syntax error: {jde.msg} at line {jde.lineno} col {jde.colno}", **metrics}

            if not schema_definition:
                # If no schema defined, simple valid JSON is a success
                metrics["schema_compliance"] = True
                return 1.0, True, {"info": "JSON parsed successfully, no schema defined.", **metrics}

            try:
                validate(instance=parsed_json, schema=schema_definition)
                metrics["schema_compliance"] = True
                score = 0.9 if metrics["extra_text"] else 1.0  # Slight penalty for conversational wrapping
                return score, True, {"info": "JSON conforms to schema.", **metrics}
            except ValidationError as ve:
                return 0.5, False, {
                    "error": f"JSON schema non-compliance: {ve.message} in path {list(ve.absolute_path)}",
                    **metrics
                }

        # 6. Code Sandbox Test (Task 2.3)
        elif evaluator_type == "code_test":
            code_blocks = re.findall(r"```python\s*(.*?)\s*```", response_text, re.DOTALL)
            if not code_blocks:
                code_blocks = re.findall(r"```\s*(.*?)\s*```", response_text, re.DOTALL)
                if not code_blocks:
                    return 0.0, False, {"error": "No markdown code block found in response."}
            
            code_content = code_blocks[0]
            
            from app.engine.sandbox import is_docker_available, run_code_in_sandbox
            if is_docker_available():
                try:
                    success, stdout, stderr = _run_sync(run_code_in_sandbox(code_content))
                    score = 1.0 if success else 0.2
                    return score, success, {"sandbox": True, "stdout": stdout, "stderr": stderr}
                except Exception as e:
                    return 0.0, False, {"error": f"Docker sandbox execution error: {str(e)}"}
            else:
                try:
                    compile(code_content, "<string>", "exec")
                    return 1.0, True, {"info": "Python syntax validation succeeded. Docker was unavailable, fell back to compile check.", "sandbox": False, "syntax_check": True}
                except SyntaxError as se:
                    return 0.2, False, {"error": f"Python compilation failed: {se.msg} at line {se.lineno}", "sandbox": False, "syntax_check": False}

        # 7. Semantic Similarity (Task 2.4)
        elif evaluator_type == "semantic_similarity":
            if not expected_answer:
                return 1.0, True, {"info": "No expected reference answer provided, defaults to pass."}
            try:
                similarity = _calculate_cosine_similarity(response_text, expected_answer)
                passed = similarity >= 0.70
                return similarity, passed, {"similarity_score": similarity, "expected": expected_answer, "actual": response_text}
            except Exception as e:
                return 0.0, False, {"error": f"Semantic similarity grading failed: {str(e)}"}

        # Default fallback
        else:
            return 1.0, True, {"info": f"Unknown evaluator type '{evaluator_type}'. Assumed pass."}

    @staticmethod
    async def evaluate_llm_judge(
        response_text: str,
        prompt_text: str,
        expected_answer: Optional[str],
        judge_provider_client,  # Instance of InferenceProvider
        judge_model_name: str
    ) -> Tuple[float, bool, Dict[str, Any]]:
        """
        Executes LLM-as-a-judge evaluation by prompt template mapping.
        """
        judge_system = (
            "You are an impartial expert evaluator scoring another AI assistant's response. "
            "Your output must be a single JSON object containing 'score' (a float from 0.0 to 1.0) "
            "and a 'reasoning' (a brief explanation of your score). "
            "For example:\n"
            "{\n  \"score\": 0.9,\n  \"reasoning\": \"The response is highly accurate and logical, containing only small formatting errors.\"\n}"
        )
        
        judge_user = (
            f"User Prompt: \"{prompt_text}\"\n\n"
            f"Expected Reference Answer (if any): \"{expected_answer or 'N/A'}\"\n\n"
            f"Assistant Response to Evaluate: \"{response_text}\"\n\n"
            "Please grade the response based on accuracy, completeness, and formatting."
        )

        try:
            # We request with standard options
            result = await judge_provider_client.generate(
                model=judge_model_name,
                prompt=judge_user,
                system_prompt=judge_system,
                options={"temperature": 0.0, "max_tokens": 256}
            )
            
            if result.error:
                return 0.0, False, {"error": f"LLM Judge API failure: {result.error}"}
                
            # Parse response
            text = result.text.strip()
            json_start = text.find("{")
            json_end = text.rfind("}")
            if json_start != -1 and json_end != -1:
                text = text[json_start:json_end+1]
                
            data = json.loads(text)
            score = float(data.get("score", 0.0))
            reasoning = data.get("reasoning", "No explanation provided.")
            passed = score >= 0.70
            
            return score, passed, {
                "judge_model": judge_model_name,
                "judge_provider": judge_provider_client.name,
                "score": score,
                "reasoning": reasoning,
                "raw_judge_response": result.text
            }
        except Exception as e:
            return 0.0, False, {"error": f"LLM Judge scoring exception: {str(e)}"}

def _run_sync(coro):
    import asyncio
    from concurrent.futures import ThreadPoolExecutor
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return asyncio.run(coro)
    with ThreadPoolExecutor(max_workers=1) as executor:
        future = executor.submit(asyncio.run, coro)
        return future.result()

_embedding_model = None

def _calculate_cosine_similarity(text1: str, text2: str) -> float:
    global _embedding_model
    if _embedding_model is None:
        from sentence_transformers import SentenceTransformer
        _embedding_model = SentenceTransformer("all-MiniLM-L6-v2")
    
    embeddings = _embedding_model.encode([text1, text2])
    import numpy as np
    emb1 = embeddings[0]
    emb2 = embeddings[1]
    
    dot_product = np.dot(emb1, emb2)
    norm_emb1 = np.linalg.norm(emb1)
    norm_emb2 = np.linalg.norm(emb2)
    
    if norm_emb1 == 0 or norm_emb2 == 0:
        return 0.0
    return float(dot_product / (norm_emb1 * norm_emb2))
