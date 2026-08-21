import datetime
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Text, JSON, BigInteger
from sqlalchemy.orm import relationship
from app.database import Base

class Provider(Base):
    __tablename__ = "providers"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    type = Column(String, nullable=False)  # ollama, vllm, llamacpp, transformers, openai_compatible, mock
    base_url = Column(String, nullable=False)
    api_key = Column(String, nullable=True)
    enabled = Column(Boolean, default=True)
    last_status = Column(String, default="UNTESTED")
    last_error = Column(String, nullable=True)
    last_models = Column(String, nullable=True)
    max_concurrency = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)

    # Relationships
    requests = relationship("BenchmarkRequest", back_populates="provider", cascade="all, delete-orphan")

class Model(Base):
    __tablename__ = "models"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, index=True)
    revision = Column(String, nullable=True)
    quantization = Column(String, nullable=True)
    size_bytes = Column(BigInteger, nullable=True)
    context_length = Column(Integer, nullable=True)
    parameters = Column(String, nullable=True)  # e.g., "8B"
    architecture = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    # Relationships
    configs = relationship("BenchmarkConfig", back_populates="model", cascade="all, delete-orphan")

class PromptSuite(Base):
    __tablename__ = "prompt_suites"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, unique=True)
    description = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    # Relationships
    prompts = relationship("Prompt", back_populates="suite", cascade="all, delete-orphan")

class Prompt(Base):
    __tablename__ = "prompts"

    id = Column(Integer, primary_key=True, index=True)
    suite_id = Column(Integer, ForeignKey("prompt_suites.id", ondelete="CASCADE"), nullable=False)
    category = Column(String, nullable=False, index=True)
    prompt = Column(Text, nullable=False)
    system_prompt = Column(Text, nullable=True)
    expected_answer = Column(Text, nullable=True)
    evaluator = Column(String, default="exact_match")  # exact_match, contains, regex, json_schema, custom_python, llm_judge
    schema_definition = Column(JSON, nullable=True)  # JSON Schema if validator is json_schema
    difficulty = Column(String, default="medium")
    tags = Column(String, nullable=True)  # Comma separated
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    # Relationships
    suite = relationship("PromptSuite", back_populates="prompts")
    requests = relationship("BenchmarkRequest", back_populates="prompt", cascade="all, delete-orphan")

class BenchmarkConfig(Base):
    __tablename__ = "benchmark_configs"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    model_id = Column(Integer, ForeignKey("models.id"), nullable=False)
    temperature = Column(Float, default=0.0)
    top_p = Column(Float, default=1.0)
    top_k = Column(Integer, default=50)
    seed = Column(Integer, default=42)
    max_tokens = Column(Integer, default=128)
    stop_sequences = Column(String, nullable=True)  # Comma separated
    repetitions = Column(Integer, default=5)
    warmup_requests = Column(Integer, default=2)
    concurrency = Column(Integer, default=1)
    request_rate = Column(Float, nullable=True)  # req/s
    use_identical_settings = Column(Boolean, default=True)
    config_hash = Column(String, nullable=False, unique=True, index=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    # Relationships
    model = relationship("Model", back_populates="configs")
    runs = relationship("BenchmarkRun", back_populates="config", cascade="all, delete-orphan")

class BenchmarkRun(Base):
    __tablename__ = "benchmark_runs"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    config_id = Column(Integer, ForeignKey("benchmark_configs.id"), nullable=False)
    status = Column(String, default="PENDING")  # PENDING, RUNNING, COMPLETED, FAILED, STOPPED
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    total_requests = Column(Integer, default=0)
    completed_requests = Column(Integer, default=0)
    failed_requests = Column(Integer, default=0)
    duration_seconds = Column(Float, default=0.0)
    hardware_info = Column(JSON, nullable=True)  # CPU, RAM, GPU info snapshot
    error_message = Column(Text, nullable=True)
    mean_ttft_ms = Column(Float, nullable=True)
    mean_tpot_ms = Column(Float, nullable=True)
    json_success_rate = Column(Float, nullable=True)
    accuracy_score = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    # Relationships
    config = relationship("BenchmarkConfig", back_populates="runs")
    requests = relationship("BenchmarkRequest", back_populates="run", cascade="all, delete-orphan")
    telemetry_samples = relationship("TelemetrySample", back_populates="run", cascade="all, delete-orphan")
    reports = relationship("Report", back_populates="run", cascade="all, delete-orphan")

class BenchmarkRequest(Base):
    __tablename__ = "benchmark_requests"

    id = Column(Integer, primary_key=True, index=True)
    run_id = Column(Integer, ForeignKey("benchmark_runs.id", ondelete="CASCADE"), nullable=False)
    provider_id = Column(Integer, ForeignKey("providers.id"), nullable=False)
    model_name = Column(String, nullable=False)
    prompt_id = Column(Integer, ForeignKey("prompts.id"), nullable=False)
    request_index = Column(Integer, nullable=False)
    repetition_index = Column(Integer, nullable=False)
    concurrency_index = Column(Integer, nullable=False)
    status = Column(String, default="PENDING")  # PENDING, RUNNING, SUCCESS, FAILED
    start_time = Column(BigInteger, nullable=True)  # epoch microseconds
    first_token_time = Column(BigInteger, nullable=True)  # epoch microseconds
    finish_time = Column(BigInteger, nullable=True)  # epoch microseconds
    prompt_tokens = Column(Integer, default=0)
    output_tokens = Column(Integer, default=0)
    total_tokens = Column(Integer, default=0)
    token_count_source = Column(String, default="unknown")  # provider, tokenizer, estimated, unknown
    response_text = Column(Text, nullable=True)
    error_message = Column(Text, nullable=True)
    http_status = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    # Relationships
    run = relationship("BenchmarkRun", back_populates="requests")
    provider = relationship("Provider", back_populates="requests")
    prompt = relationship("Prompt", back_populates="requests")
    quality_results = relationship("QualityResult", back_populates="request", cascade="all, delete-orphan")

class TelemetrySample(Base):
    __tablename__ = "telemetry_samples"

    id = Column(Integer, primary_key=True, index=True)
    run_id = Column(Integer, ForeignKey("benchmark_runs.id", ondelete="CASCADE"), nullable=False)
    timestamp = Column(BigInteger, nullable=False)  # epoch microseconds
    cpu_utilization = Column(Float, nullable=False)
    ram_used_bytes = Column(BigInteger, nullable=False)
    ram_total_bytes = Column(BigInteger, nullable=False)
    gpu_utilization = Column(JSON, nullable=True)  # List of GPU usage statistics (temp, power, memory, active % etc)

    # Relationships
    run = relationship("BenchmarkRun", back_populates="telemetry_samples")

class QualityResult(Base):
    __tablename__ = "quality_results"

    id = Column(Integer, primary_key=True, index=True)
    request_id = Column(Integer, ForeignKey("benchmark_requests.id", ondelete="CASCADE"), nullable=False)
    evaluator_type = Column(String, nullable=False)  # exact_match, regex, json_schema, llm_judge, etc.
    score = Column(Float, default=0.0)  # 0.0 to 1.0 or normalized 0-100
    passed = Column(Boolean, default=False)
    details = Column(JSON, nullable=True)  # logs of why, schema validation errors, judge comments
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    # Relationships
    request = relationship("BenchmarkRequest", back_populates="quality_results")

class Report(Base):
    __tablename__ = "reports"

    id = Column(Integer, primary_key=True, index=True)
    run_id = Column(Integer, ForeignKey("benchmark_runs.id", ondelete="CASCADE"), nullable=False)
    summary = Column(Text, nullable=True)
    recommendations = Column(JSON, nullable=True)  # Recommended provider profiles
    created_at = Column(DateTime, default=datetime.datetime.utcnow)

    # Relationships
    run = relationship("BenchmarkRun", back_populates="reports")


class SystemMetrics(Base):
    __tablename__ = "system_metrics"
    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(BigInteger, nullable=False, index=True)
    cpu_utilization = Column(Float, nullable=False)
    ram_used_bytes = Column(BigInteger, nullable=False)
    ram_total_bytes = Column(BigInteger, nullable=False)
    gpu_utilization = Column(JSON, nullable=True)

class SystemEventLog(Base):
    __tablename__ = "system_event_logs"
    id = Column(Integer, primary_key=True, index=True)
    timestamp = Column(BigInteger, nullable=False, index=True)
    level = Column(String, nullable=False) # INFO, WARNING, ERROR
    source = Column(String, nullable=False) # e.g. "engine", "provider_sync", "hardware_monitor"
    message = Column(Text, nullable=False)
    details = Column(JSON, nullable=True)
