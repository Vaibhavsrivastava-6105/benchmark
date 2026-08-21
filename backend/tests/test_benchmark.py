import pytest
from app.engine.evaluator import ResponseEvaluator
from app.engine.recommendation import RecommendationEngine

def test_evaluator_exact_match():
    # Test identical matching
    score, passed, details = ResponseEvaluator.evaluate(
        "exact_match", "1776", expected_answer="1776"
    )
    assert score == 1.0
    assert passed is True
    assert details["actual"] == "1776"

    # Test mismatch
    score, passed, details = ResponseEvaluator.evaluate(
        "exact_match", "1766", expected_answer="1776"
    )
    assert score == 0.0
    assert passed is False

def test_evaluator_contains():
    # Test substring containment
    score, passed, details = ResponseEvaluator.evaluate(
        "contains", "The product equals 1776, which is correct.", expected_answer="1776"
    )
    assert score == 1.0
    assert passed is True

    score, passed, details = ResponseEvaluator.evaluate(
        "contains", "The product equals 1000.", expected_answer="1776"
    )
    assert score == 0.0
    assert passed is False

def test_evaluator_json_schema():
    schema = {
        "type": "object",
        "properties": {
            "name": {"type": "string"},
            "value": {"type": "number"}
        },
        "required": ["name", "value"]
    }
    
    # Valid compliance
    response = '{"name": "test", "value": 42}'
    score, passed, details = ResponseEvaluator.evaluate(
        "json_schema", response, schema_definition=schema
    )
    assert score == 1.0
    assert passed is True
    assert details["valid_json"] is True
    assert details["schema_compliance"] is True

    # Malformed JSON syntax
    response_broken = '{"name": "test", "value": 42'
    score, passed, details = ResponseEvaluator.evaluate(
        "json_schema", response_broken, schema_definition=schema
    )
    assert score == 0.0
    assert passed is False
    assert details["malformed_json"] is True

    # Schema non-compliance
    response_wrong = '{"name": "test", "value": "forty-two"}'
    score, passed, details = ResponseEvaluator.evaluate(
        "json_schema", response_wrong, schema_definition=schema
    )
    assert score == 0.5
    assert passed is False
    assert details["valid_json"] is True
    assert details["schema_compliance"] is False

def test_recommendation_ranking():
    # Create mock metrics summary
    metrics = {
        1: {
            "provider_id": 1,
            "provider_name": "vLLM",
            "provider_type": "vllm",
            "throughput_tok_s": 80.0,
            "ttft_ms": 150.0,
            "avg_latency_ms": 1200.0,
            "reliability_pct": 100.0,
            "quality_pct": 95.0,
            "json_reliability_pct": 100.0,
            "vram_used_gb": 6.0,
            "vram_efficiency_tok_s_gb": 80.0 / 6.0,
            "operational_complexity_score": 70.0
        },
        2: {
            "provider_id": 2,
            "provider_name": "llama.cpp",
            "provider_type": "llamacpp",
            "throughput_tok_s": 40.0,
            "ttft_ms": 220.0,
            "avg_latency_ms": 2400.0,
            "reliability_pct": 100.0,
            "quality_pct": 90.0,
            "json_reliability_pct": 98.0,
            "vram_used_gb": 4.0,
            "vram_efficiency_tok_s_gb": 40.0 / 4.0,
            "operational_complexity_score": 85.0
        }
      }

    # Rank by best_overall
    ranks = RecommendationEngine.rank_providers(metrics, objective="best_overall")
    assert len(ranks) == 2
    # vLLM should win due to higher throughput and lower TTFT
    assert ranks[0]["provider_name"] == "vLLM"
    assert ranks[0]["composite_score"] > ranks[1]["composite_score"]

    # Rank by local_development where operational simplicity score has high weight (30%)
    local_ranks = RecommendationEngine.rank_providers(metrics, objective="local_development")
    # llama.cpp might score closer or higher depending on local weights
    assert len(local_ranks) == 2

def test_evaluator_code_test():
    # Valid syntax block
    code = "```python\ndef add(a, b):\n    return a + b\n```"
    score, passed, details = ResponseEvaluator.evaluate("code_test", code)
    assert score == 1.0
    assert passed is True
    
    # Broken syntax block
    broken_code = "```python\ndef add(a, b)\n    return a + b\n```"
    score, passed, details = ResponseEvaluator.evaluate("code_test", broken_code)
    assert score == 0.2
    assert passed is False

def test_evaluator_semantic_similarity():
    # Similar meaning
    score1, passed1, details1 = ResponseEvaluator.evaluate(
        "semantic_similarity", 
        "The quick brown fox jumps over the lazy dog.", 
        expected_answer="A fast brown fox leaps over a sleepy dog."
    )
    assert score1 > 0.60
    assert passed1 is True
    
    # Completely different meaning
    score2, passed2, details2 = ResponseEvaluator.evaluate(
        "semantic_similarity", 
        "The quick brown fox jumps over the lazy dog.", 
        expected_answer="Insurmountable inflation rates affected economic growth in Europe."
    )
    assert score2 < 0.50
    assert score1 > score2
