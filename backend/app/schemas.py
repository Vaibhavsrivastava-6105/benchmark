from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from datetime import datetime

# --- PROVIDERS ---
class ProviderBase(BaseModel):
    name: str
    type: str  # ollama, vllm, llamacpp, transformers, openai_compatible, mock
    base_url: str
    api_key: Optional[str] = None
    enabled: Optional[bool] = True
    max_concurrency: Optional[int] = None
    setup_complexity: Optional[str] = "medium"

class ProviderCreate(ProviderBase):
    pass

class ProviderUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[str] = None
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    enabled: Optional[bool] = None
    max_concurrency: Optional[int] = None

class ProviderResponse(ProviderBase):
    id: int
    last_status: Optional[str] = "UNTESTED"
    last_error: Optional[str] = None
    last_models: Optional[str] = None
    process_telemetry: Optional[dict] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

# --- MODELS ---
class ModelBase(BaseModel):
    name: str
    version: Optional[str] = "1.0.0"
    version_hash: Optional[str] = None
    is_immutable: Optional[bool] = True
    changelog: Optional[str] = None
    revision: Optional[str] = None
    quantization: Optional[str] = None
    size_bytes: Optional[int] = None
    context_length: Optional[int] = None
    parameters: Optional[str] = None
    architecture: Optional[str] = None
    cost_input_per_1k: Optional[float] = 0.0
    cost_output_per_1k: Optional[float] = 0.0

class ModelCreate(ModelBase):
    pass

class ModelResponse(ModelBase):
    id: int
    created_at: datetime

    class Config:
        from_attributes = True

# --- PROMPTS ---
class PromptBase(BaseModel):
    category: str
    prompt: str
    version: Optional[str] = "1.0.0"
    version_hash: Optional[str] = None
    system_prompt: Optional[str] = None
    system_prompt_version: Optional[str] = "1.0.0"
    expected_answer: Optional[str] = None
    evaluator: Optional[str] = "exact_match"
    schema_definition: Optional[Dict[str, Any]] = None
    difficulty: Optional[str] = "medium"
    tags: Optional[str] = None

class PromptCreate(PromptBase):
    pass

class PromptResponse(PromptBase):
    id: int
    suite_id: int
    created_at: datetime

    class Config:
        from_attributes = True

# --- PROMPT SUITES ---
class PromptSuiteBase(BaseModel):
    name: str
    description: Optional[str] = None
    version: Optional[str] = "1.0.0"
    version_hash: Optional[str] = None
    is_immutable: Optional[bool] = True
    author: Optional[str] = "System"

class PromptSuiteCreate(PromptSuiteBase):
    prompts: Optional[List[PromptCreate]] = []

class PromptSuiteResponse(PromptSuiteBase):
    id: int
    created_at: datetime
    prompts: List[PromptResponse] = []

    class Config:
        from_attributes = True

# --- BENCHMARK CONFIGS ---
class BenchmarkConfigBase(BaseModel):
    name: str
    temperature: Optional[float] = 0.0
    top_p: Optional[float] = 1.0
    top_k: Optional[int] = 50
    seed: Optional[int] = 42
    max_tokens: Optional[int] = 128
    stop_sequences: Optional[str] = None
    repetitions: Optional[int] = 5
    warmup_requests: Optional[int] = 2
    concurrency: Optional[int] = 1
    request_rate: Optional[float] = None
    use_identical_settings: Optional[bool] = True
    dataset_version_snapshot: Optional[Dict[str, Any]] = None
    model_version_snapshot: Optional[Dict[str, Any]] = None
    local_electricity_cost_kwh: Optional[float] = 0.12

class BenchmarkConfigCreate(BenchmarkConfigBase):
    model_name: Optional[str] = None
    model_revision: Optional[str] = None
    model_quantization: Optional[str] = None
    model_context_length: Optional[int] = None
    model_parameters: Optional[str] = None
    model_architecture: Optional[str] = None

class BenchmarkConfigResponse(BenchmarkConfigBase):
    id: int
    model_id: Optional[int] = None
    model: Optional[ModelResponse] = None
    config_hash: str
    created_at: datetime

    class Config:
        from_attributes = True

# --- BENCHMARK RUNS ---
class BenchmarkRunCreate(BaseModel):
    name: str
    config_id: Optional[int] = None
    config_create: Optional[BenchmarkConfigCreate] = None
    model_names: List[str] = []
    provider_ids: List[int]
    targets: Optional[List[Dict[str, Any]]] = None
    prompt_suite_ids: List[int]
    # Options for LLM Judge
    llm_judge_provider_id: Optional[int] = None
    llm_judge_model_name: Optional[str] = None
    benchmark_mode: Optional[str] = 'standard' # standard, structured_json, exact_match, llm_judge
    exact_match_keyword: Optional[str] = None
    sequential_execution: Optional[bool] = True
    custom_hardware_profile: Optional[str] = None

class BenchmarkRunResponse(BaseModel):
    id: int
    name: str
    config_id: int
    config: BenchmarkConfigResponse
    status: str
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    total_requests: int
    completed_requests: int
    failed_requests: int
    duration_seconds: float
    hardware_info: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None
    
    # Statistical Latency & Throughput Metrics
    mean_ttft_ms: Optional[float] = None
    std_dev_ttft_ms: Optional[float] = None
    mean_tpot_ms: Optional[float] = None
    std_dev_latency_ms: Optional[float] = None
    p50_latency_ms: Optional[float] = None
    p90_latency_ms: Optional[float] = None
    p95_latency_ms: Optional[float] = None
    p99_latency_ms: Optional[float] = None
    
    # Quality & Reliability Metrics
    json_success_rate: Optional[float] = None
    accuracy_score: Optional[float] = None
    instruction_following_rate: Optional[float] = None
    reasoning_score: Optional[float] = None
    consistency_score: Optional[float] = None
    hallucination_rate: Optional[float] = None
    llm_judge_score: Optional[float] = None
    human_judge_alignment: Optional[float] = None

    # Financial Cost & Energy Consumption Metrics
    total_cost_usd: Optional[float] = 0.0
    cost_per_1k_tokens: Optional[float] = 0.0
    cost_per_1m_tokens: Optional[float] = 0.0
    energy_consumption_kwh: Optional[float] = 0.0
    energy_cost_usd: Optional[float] = 0.0

    # Immutable Snapshots
    dataset_snapshot: Optional[Dict[str, Any]] = None
    model_snapshot: Optional[Dict[str, Any]] = None

    created_at: datetime

    class Config:
        from_attributes = True

# --- QUALITY RESULTS ---
class QualityResultResponse(BaseModel):
    id: int
    request_id: int
    evaluator_type: str
    score: float
    passed: bool
    details: Optional[Dict[str, Any]] = None
    created_at: datetime

    class Config:
        from_attributes = True

# --- REQUESTS ---
class BenchmarkRequestResponse(BaseModel):
    id: int
    run_id: int
    provider_id: int
    provider: ProviderResponse
    model_name: Optional[str] = None
    prompt_id: int
    prompt: PromptResponse
    request_index: int
    repetition_index: int
    concurrency_index: int
    status: str
    start_time: Optional[int] = None
    first_token_time: Optional[int] = None
    finish_time: Optional[int] = None
    prompt_tokens: int
    output_tokens: int
    total_tokens: int
    token_count_source: str
    response_text: Optional[str] = None
    error_message: Optional[str] = None
    http_status: Optional[int] = None
    quality_results: List[QualityResultResponse] = []
    created_at: datetime

    class Config:
        from_attributes = True

# --- TELEMETRY ---
class TelemetrySampleResponse(BaseModel):
    id: int
    run_id: int
    timestamp: int
    cpu_utilization: float
    ram_used_bytes: int
    ram_total_bytes: int
    gpu_utilization: Optional[List[Dict[str, Any]]] = None

    class Config:
        from_attributes = True

# --- REPORTS ---
class ReportResponse(BaseModel):
    id: int
    run_id: int
    summary: Optional[str] = None
    recommendations: Optional[Dict[str, Any]] = None
    created_at: datetime

    class Config:
        from_attributes = True

# --- COMPARISONS & RECOMMENDATIONS ---
class ComparisonRequest(BaseModel):
    run_ids: List[int]

class RecommendationWeights(BaseModel):
    quality: float = 0.30
    throughput: float = 0.20
    latency: float = 0.20
    vram_efficiency: float = 0.10
    reliability: float = 0.10
    json_reliability: float = 0.05
    operational_complexity: float = 0.05

