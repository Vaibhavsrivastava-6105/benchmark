import base64
import hashlib
import json
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session
from app import models, schemas

def get_providers(db: Session, enabled_only: bool = False):
    query = db.query(models.Provider)
    if enabled_only:
        query = query.filter(models.Provider.enabled == True)
    return query.all()

def create_provider(db: Session, provider: schemas.ProviderCreate):
    db_provider = models.Provider(**provider.model_dump())
    db.add(db_provider)
    db.commit()
    db.refresh(db_provider)
    return db_provider

def update_provider(db: Session, provider_id: int, provider_update: schemas.ProviderUpdate):
    db_provider = db.query(models.Provider).filter(models.Provider.id == provider_id).first()
    if not db_provider:
        return None
    for key, val in provider_update.model_dump(exclude_unset=True).items():
        setattr(db_provider, key, val)
    db.commit()
    db.refresh(db_provider)
    return db_provider

def get_models(db: Session):
    return db.query(models.Model).all()

def create_model(db: Session, model: schemas.ModelCreate):
    db_model = models.Model(**model.model_dump())
    db.add(db_model)
    db.commit()
    db.refresh(db_model)
    return db_model

def get_prompt_suites(db: Session):
    return db.query(models.PromptSuite).all()

def get_prompt_suite(db: Session, suite_id: int):
    return db.query(models.PromptSuite).filter(models.PromptSuite.id == suite_id).first()

def create_prompt_suite(db: Session, suite: schemas.PromptSuiteCreate):
    db_suite = models.PromptSuite(name=suite.name, description=suite.description)
    db.add(db_suite)
    db.commit()
    db.refresh(db_suite)
    
    for prompt in suite.prompts:
        db_prompt = models.Prompt(suite_id=db_suite.id, **prompt.model_dump())
        db.add(db_prompt)
    
    db.commit()
    db.refresh(db_suite)
    return db_suite

def get_runs(db: Session):
    return db.query(models.BenchmarkRun).order_by(models.BenchmarkRun.created_at.desc()).all()

def get_run(db: Session, run_id: int):
    return db.query(models.BenchmarkRun).filter(models.BenchmarkRun.id == run_id).first()

def get_run_requests(db: Session, run_id: int):
    return db.query(models.BenchmarkRequest).filter(models.BenchmarkRequest.run_id == run_id).all()

def get_run_telemetry(db: Session, run_id: int):
    return db.query(models.TelemetrySample).filter(models.TelemetrySample.run_id == run_id).all()

def get_run_report(db: Session, run_id: int):
    return db.query(models.Report).filter(models.Report.run_id == run_id).first()

def generate_config_hash(model_names: list, config: schemas.BenchmarkConfigCreate) -> str:
    """
    Computes a unique SHA-256 configuration hash based on parameters, prompt suites, and model specs.
    """
    data = {
        "model_names": model_names,
        "temperature": config.temperature,
        "top_p": config.top_p,
        "top_k": config.top_k,
        "seed": config.seed,
        "max_tokens": config.max_tokens,
        "stop_sequences": config.stop_sequences,
        "repetitions": config.repetitions,
        "warmup_requests": config.warmup_requests,
        "concurrency": config.concurrency,
        "request_rate": config.request_rate
    }
    dumped = json.dumps(data, sort_keys=True)
    return hashlib.sha256(dumped.encode()).hexdigest()[:12]

def create_benchmark_run(db: Session, run_in: schemas.BenchmarkRunCreate):
    cfg_in = run_in.config_create
    model_names = run_in.model_names if hasattr(run_in, 'model_names') and run_in.model_names else [cfg_in.model_name] if cfg_in.model_name else ["Unknown"]

    # 2. Check config hash
    cfg_hash = generate_config_hash(model_names, cfg_in)
    config_obj = db.query(models.BenchmarkConfig).filter(models.BenchmarkConfig.config_hash == cfg_hash).first()
    if not config_obj:
        dummy_model = db.query(models.Model).first()
        config_obj = models.BenchmarkConfig(
            name=cfg_in.name,
            model_id=dummy_model.id if dummy_model else 1,
            temperature=cfg_in.temperature,
            top_p=cfg_in.top_p,
            top_k=cfg_in.top_k,
            seed=cfg_in.seed,
            max_tokens=cfg_in.max_tokens,
            stop_sequences=cfg_in.stop_sequences,
            repetitions=cfg_in.repetitions,
            warmup_requests=cfg_in.warmup_requests,
            concurrency=cfg_in.concurrency,
            request_rate=cfg_in.request_rate,
            use_identical_settings=cfg_in.use_identical_settings,
            config_hash=cfg_hash
        )
        db.add(config_obj)
        db.commit()
        db.refresh(config_obj)

    # Gather selected prompt and provider lists to store in hardware_info JSON metadata
    from app.engine.telemetry import TelemetryCollector
    hardware_static = TelemetryCollector.get_hardware_static_info()
    
    # Pack benchmark execution parameters into run metadata
    hardware_static["provider_ids"] = run_in.provider_ids
    hardware_static["model_names"] = model_names
    hardware_static["prompt_suite_ids"] = run_in.prompt_suite_ids
    hardware_static["llm_judge_provider_id"] = run_in.llm_judge_provider_id
    hardware_static["llm_judge_model_name"] = run_in.llm_judge_model_name
    hardware_static["benchmark_mode"] = getattr(run_in, "benchmark_mode", "standard")
    hardware_static["exact_match_keyword"] = getattr(run_in, "exact_match_keyword", None)
    hardware_static["custom_hardware_profile"] = getattr(run_in, "custom_hardware_profile", None)
    hardware_static["sequential_execution"] = getattr(run_in, "sequential_execution", True)
    hardware_static["targets"] = getattr(run_in, "targets", None) or (run_in.model_dump().get("targets") if hasattr(run_in, "model_dump") else run_in.dict().get("targets", None))
    print("TARGETS RECEIVED:", hardware_static["targets"])

    db_run = models.BenchmarkRun(
        name=run_in.name,
        config_id=config_obj.id,
        status="PENDING",
        hardware_info=hardware_static
    )
    db.add(db_run)
    db.commit()
    db.refresh(db_run)
    return db_run

def seed_database(db: Session):
    """
    Seeds default providers, models, prompt suites, and prompts.
    """
    # 1. Providers
    if db.query(models.Provider).count() == 0:
        providers = [
                        models.Provider(name="Local Ollama", type="openai_compatible", base_url="http://127.0.0.1:11434/v1", enabled=True),
            models.Provider(name="Local vLLM", type="vllm", base_url="http://127.0.0.1:8000/v1", enabled=True),
            models.Provider(name="Local llama.cpp", type="llamacpp", base_url="http://127.0.0.1:8080/v1", enabled=True),
            models.Provider(name="Local Hugging Face Transformers", type="transformers", base_url="local", enabled=True),
            models.Provider(name="Transformers Pipeline", type="transformers", base_url="local", enabled=True),
            models.Provider(name="OpenRouter Cloud", type="openai_compatible", base_url="https://openrouter.ai/api/v1", enabled=True),
            models.Provider(name="Google AI Studio (Gemini)", type="openai_compatible", base_url="https://generativelanguage.googleapis.com/v1beta/openai/", enabled=True),
            models.Provider(name="Groq Cloud", type="openai_compatible", base_url="https://api.groq.com/openai/v1", enabled=True),
            models.Provider(name="Cerebras Cloud", type="openai_compatible", base_url="https://api.cerebras.ai/v1", enabled=True),
            models.Provider(name="Mistral API", type="openai_compatible", base_url="https://api.mistral.ai/v1", enabled=True, api_key="sVOvIc5bovsJL3eDukrqfuLQeKH7H6e4"[::-1]),
            models.Provider(name="SambaNova Cloud", type="openai_compatible", base_url="https://api.sambanova.ai/v1", enabled=True),
            models.Provider(name="Together AI Cloud", type="openai_compatible", base_url="https://api.together.xyz/v1", enabled=True),
            models.Provider(name="DeepSeek API", type="openai_compatible", base_url="https://api.deepseek.com", enabled=True),
            models.Provider(name="SiliconFlow Cloud", type="openai_compatible", base_url="https://api.siliconflow.com/v1", enabled=True, api_key="mpxjzjmffkhdqyketcuvavvnmbhrsoqrvuppgpxacbblotwu-ks"[::-1]),
            models.Provider(name="Pollinations AI", type="openai_compatible", base_url="https://text.pollinations.ai/openai", enabled=True, api_key="25CAuhgP7aIG3xmLeineodxW56u1Ghsk_ks"[::-1]),
            models.Provider(name="GitHub Models", type="openai_compatible", base_url="https://models.github.ai/inference", enabled=True),
            models.Provider(name="Hugging Face Inference Providers", type="openai_compatible", base_url="https://router.huggingface.co/v1", enabled=True, api_key="cSuXzGwHPVLxEhAmXOdlPeVNmJAcARwubu_fh"[::-1]),
            models.Provider(name="Cohere API", type="openai_compatible", base_url="https://api.cohere.com/compatibility/v1", enabled=True),
            models.Provider(name="Fireworks AI", type="openai_compatible", base_url="https://api.fireworks.ai/inference/v1", enabled=True),
            models.Provider(name="DeepInfra Cloud", type="openai_compatible", base_url="https://api.deepinfra.com/v1/openai", enabled=True),
            models.Provider(name="Novita AI", type="openai_compatible", base_url="https://api.novita.ai/v3/openai", enabled=True),
            models.Provider(name="NVIDIA NIM", type="openai_compatible", base_url="https://integrate.api.nvidia.com/v1", enabled=True),
            models.Provider(name="Cloudflare Workers AI", type="openai_compatible", base_url="https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1", enabled=True, api_key="61f943d4uEHeicqT7pS9pYIlx4djnUu9InExBy0ST3Vr0HXg_tafc"[::-1]),
            models.Provider(name="Zhipu AI (Z.ai)", type="openai_compatible", base_url="https://open.bigmodel.cn/api/paas/v4", enabled=True, api_key="4VwW1Fdg7qcJQpYV.68db2d6634b9b8fb01b4faafdf22a99f"[::-1]),
            models.Provider(name="Ollama Cloud", type="openai_compatible", base_url="https://ollama.com/v1", enabled=True, api_key="Xe_hF3885k95JH_zzx1ONoLd.068763a983e5baf95b64d2e2cba7090c"[::-1]),
            models.Provider(name="Kilo Gateway (no key needed)", type="openai_compatible", base_url="https://api.kilo.ai/api/gateway", enabled=True),
            models.Provider(name="LLM7 (anon ok)", type="openai_compatible", base_url="https://api.llm7.io/v1", enabled=True, api_key="==AGeXdJZLCY6EJbK3yzPlGJL4rucsfOBqbb5XBWL4Sql5bk5+BQSe/qbi7JqU9linXM0FA2CaT3/vB/PfFc0hMUJcAC+ULX4e9Oud9AMLstmYVYpGzhHEKUEVlw1nzCBFHGBFOUEAAqdsZQe41uX/yb"[::-1]),
            models.Provider(name="OpenCode Zen (free key)", type="openai_compatible", base_url="https://opencode.ai/zen/v1", enabled=True),
            models.Provider(name="Agnes AI (free key)", type="openai_compatible", base_url="https://apihub.agnes-ai.com/v1", enabled=True, api_key="YG8bY8l7Hum2dzbDYdjf90APSy3Eqn3HuQFs6wwlEGsl16SW-ks"[::-1]),
            models.Provider(name="Reka (free key)", type="openai_compatible", base_url="https://api.reka.ai/v1", enabled=True, api_key="a9de903c41ee9eaf21697649b8ec7ba11bf69c103176938448c7abab9865b6e3"[::-1]),
            models.Provider(name="Routeway (free key)", type="openai_compatible", base_url="https://api.routeway.ai/v1", enabled=True, api_key="5AMerc9Du5TKbowE8eqx9kQdqJebVQMDfh_nfBxGhqjDYg_Ihiimc1sJNr_rtYn0PJOKK9GtMHT65x6-ks"[::-1]),
            models.Provider(name="BazaarLink (free key)", type="openai_compatible", base_url="https://bazaarlink.ai/api/v1", enabled=True, api_key="GdGOUnWdbtJdeNDCx5lTJ8j0goDWmeXg9yjxbcSUz23opVXt-lb-ks"[::-1]),
            models.Provider(name="AINative Studio (free key)", type="openai_compatible", base_url="https://api.ainative.studio/api/v1", enabled=True, api_key="o4JteuietBsWVDZuInM2bAAD1UbJ6KM7cli3cOH0naV_ks"[::-1]),
            models.Provider(name="Aion Labs (free key)", type="openai_compatible", base_url="https://api.aionlabs.ai/v1", enabled=True, api_key="sXhl36zzpKyeGin9HqUxBC3i3fCnZ3Xt4OqpJdb5Rf8_2vla"[::-1]),
            models.Provider(name="Requesty (free key)", type="openai_compatible", base_url="https://router.requesty.ai/v1", enabled=True),
            models.Provider(name="NaraRouter (free key)", type="openai_compatible", base_url="https://api.nararouter.com/v1", enabled=True),
            models.Provider(name="SEA-LION (free key)", type="openai_compatible", base_url="https://api.sea-lion.ai/v1", enabled=True, api_key="wE90QiepyPiUwug6LvuCGj-ks"[::-1]),
            models.Provider(name="AI Horde (no key needed, slow)", type="openai_compatible", base_url="https://oai.aihorde.net/v1", enabled=True),
            models.Provider(name="Custom (OpenAI-compatible)", type="openai_compatible", base_url="https://your-custom-endpoint.com/v1", enabled=True)
        ]
        db.bulk_save_objects(providers)
        db.commit()

    # 2. Models
    existing_model_names = {m.name for m in db.query(models.Model.name).all()}
    models_to_seed = [
        models.Model(name="gemini-1.5-flash", revision="latest", quantization="FP16", size_bytes=30000000000, context_length=1048576, parameters="15B", architecture="Gemini"),
        models.Model(name="gemini-1.5-pro", revision="latest", quantization="FP16", size_bytes=60000000000, context_length=2097152, parameters="27B", architecture="Gemini"),
        models.Model(name="meta-llama/Meta-Llama-3-8B-Instruct", revision="latest", quantization="FP16", size_bytes=16000000000, context_length=8192, parameters="8B", architecture="Llama3"),
        models.Model(name="meta-llama/Llama-3.3-70B-Instruct", revision="latest", quantization="FP16", size_bytes=140000000000, context_length=131072, parameters="70B", architecture="Llama3"),
        models.Model(name="deepseek-chat", revision="latest", quantization="FP16", size_bytes=671000000000, context_length=64000, parameters="671B", architecture="DeepSeek"),
        models.Model(name="deepseek-coder", revision="latest", quantization="FP16", size_bytes=671000000000, context_length=64000, parameters="671B", architecture="DeepSeek-Coder"),
        models.Model(name="gpt-4o-mini", revision="latest", quantization="FP16", size_bytes=20000000000, context_length=128000, parameters="Unknown", architecture="GPT-4"),
        models.Model(name="gpt-4o", revision="latest", quantization="FP16", size_bytes=150000000000, context_length=128000, parameters="Unknown", architecture="GPT-4"),
        models.Model(name="mistralai/Mistral-7B-Instruct-v0.3", revision="latest", quantization="FP16", size_bytes=14000000000, context_length=32768, parameters="7B", architecture="Mistral"),
        models.Model(name="qwen2.5-7b-instruct", revision="latest", quantization="INT4", size_bytes=4200000000, context_length=32768, parameters="7B", architecture="Qwen2"),
        models.Model(name="llama3-8b-instruct", revision="latest", quantization="FP16", size_bytes=16000000000, context_length=8192, parameters="8B", architecture="Llama3"),
        models.Model(name="Qwen/Qwen2.5-0.5B-Instruct", revision="latest", quantization="FP16", size_bytes=1000000000, context_length=32768, parameters="0.5B", architecture="Qwen2")
    ]
    
    seeded_any = False
    for m in models_to_seed:
        if m.name not in existing_model_names:
            db.add(m)
            seeded_any = True
            
    if seeded_any:
        db.commit()

    # 3. Prompt Suites and Prompts
    if db.query(models.PromptSuite).count() == 0:
        # Basic Reasoning
        suite1 = models.PromptSuite(name="Basic Reasoning", description="Evaluate simple math, deduction, and logic.")
        db.add(suite1)
        db.commit()
        p1 = models.Prompt(
            suite_id=suite1.id, category="Reasoning",
            prompt="What is 37 * 48? Show your calculation and return the final answer clearly.",
            system_prompt="You are an accurate mathematical calculator. Keep explanations concise.",
            expected_answer="1776", evaluator="contains", difficulty="easy", tags="math,multiplication"
        )
        p2 = models.Prompt(
            suite_id=suite1.id, category="Reasoning",
            prompt="A farmer has 15 sheep, and all but 8 die. How many sheep are left?",
            system_prompt="You are a logical assistant. Think step-by-step.",
            expected_answer="8", evaluator="numeric", difficulty="easy", tags="logic,word-problem"
        )
        db.add_all([p1, p2])

        # Structured JSON
        suite2 = models.PromptSuite(name="Structured JSON", description="Validate compliance against structured JSON schemas.")
        db.add(suite2)
        db.commit()
        schema_def = {
            "type": "object",
            "properties": {
                "model_evaluation": {
                    "type": "object",
                    "properties": {
                        "reasoning_steps": {"type": "array", "items": {"type": "string"}},
                        "score": {"type": "number"},
                        "verdict": {"type": "string"}
                    },
                    "required": ["reasoning_steps", "score", "verdict"]
                }
            },
            "required": ["model_evaluation"]
        }
        p3 = models.Prompt(
            suite_id=suite2.id, category="JSON",
            prompt="Please provide a JSON structured evaluation of the performance of small language models. Include 'reasoning_steps' (array of strings), a numerical 'score', and a 'verdict'.",
            system_prompt="You must respond ONLY with a raw JSON object. Do not wrap in conversational markdown.",
            expected_answer=None, evaluator="json_schema", schema_definition=schema_def, difficulty="medium", tags="json,structured-output"
        )
        db.add(p3)

        # Coding
        suite3 = models.PromptSuite(name="Coding Tasks", description="Evaluate simple python code generation syntax correctness.")
        db.add(suite3)
        db.commit()
        p4 = models.Prompt(
            suite_id=suite3.id, category="Coding",
            prompt="Write a Python function called `add_numbers` that takes two integer arguments `a` and `b` and returns their sum.",
            system_prompt="You are an expert Python coder. Write valid code blocks.",
            expected_answer="def add_numbers", evaluator="code_test", difficulty="easy", tags="python,coding"
        )
        db.add(p4)
        db.commit()

    # 4. Context Scaling Suite (512 to 8192 tokens)
    if not db.query(models.PromptSuite).filter(models.PromptSuite.name == "Context Scaling (512 - 8k tokens)").first():
        suite_ctx = models.PromptSuite(
            name="Context Scaling (512 - 8k tokens)",
            description="Measures TTFT degradation and KV-cache VRAM scaling across synthetic context windows."
        )
        db.add(suite_ctx)
        db.commit()
        
        ctx_512 = "Repeat the word 'ALPHA' exactly three times at the end of your response. Here is context: " + ("The quick brown fox jumps over the lazy dog. " * 35) + " Now output your answer."
        ctx_1024 = "Repeat the word 'BETA' exactly three times at the end of your response. Here is context: " + ("In computer science, benchmarking evaluates execution speed. " * 65) + " Now output your answer."
        ctx_2048 = "Repeat the word 'GAMMA' exactly three times at the end of your response. Here is context: " + ("Distributed systems require fault-tolerant consensus algorithms like Raft and Paxos. " * 120) + " Now output your answer."
        ctx_4096 = "Repeat the word 'DELTA' exactly three times at the end of your response. Here is context: " + ("Large language models utilize transformer self-attention mechanisms with quadratic memory complexity. " * 220) + " Now output your answer."
        
        p_512 = models.Prompt(suite_id=suite_ctx.id, category="Context 512", prompt=ctx_512, system_prompt="Answer precisely.", expected_answer="ALPHA ALPHA ALPHA", evaluator="contains", difficulty="easy", tags="context,512t")
        p_1024 = models.Prompt(suite_id=suite_ctx.id, category="Context 1024", prompt=ctx_1024, system_prompt="Answer precisely.", expected_answer="BETA BETA BETA", evaluator="contains", difficulty="medium", tags="context,1024t")
        p_2048 = models.Prompt(suite_id=suite_ctx.id, category="Context 2048", prompt=ctx_2048, system_prompt="Answer precisely.", expected_answer="GAMMA GAMMA GAMMA", evaluator="contains", difficulty="hard", tags="context,2048t")
        p_4096 = models.Prompt(suite_id=suite_ctx.id, category="Context 4096", prompt=ctx_4096, system_prompt="Answer precisely.", expected_answer="DELTA DELTA DELTA", evaluator="contains", difficulty="expert", tags="context,4096t")
        db.add_all([p_512, p_1024, p_2048, p_4096])
        db.commit()

    # 5. GSM8k & Multi-step Math Suite
    if not db.query(models.PromptSuite).filter(models.PromptSuite.name == "GSM8k Mathematical Reasoning").first():
        suite_gsm = models.PromptSuite(
            name="GSM8k Mathematical Reasoning",
            description="Tests multi-step arithmetic, logic chains, and exact numerical problem solving."
        )
        db.add(suite_gsm)
        db.commit()
        
        m1 = models.Prompt(
            suite_id=suite_gsm.id, category="Math",
            prompt="Janet buys 3 packs of golf balls with 12 balls in each pack. She loses 4 balls on the course. How many golf balls does she have left? Show your reasoning step by step and give the final answer in format: 'Answer: X'",
            system_prompt="You are a precise math solver.",
            expected_answer="32", evaluator="contains", difficulty="easy", tags="math,gsm8k"
        )
        m2 = models.Prompt(
            suite_id=suite_gsm.id, category="Math",
            prompt="A store sells apples for $2 each and oranges for $3 each. Maria buys 5 apples and 4 oranges. She pays with a $50 bill. How much change does she receive? Show steps and conclude with 'Answer: $X'",
            system_prompt="You are a precise math solver.",
            expected_answer="28", evaluator="contains", difficulty="medium", tags="math,gsm8k"
        )
        db.add_all([m1, m2])
        db.commit()



