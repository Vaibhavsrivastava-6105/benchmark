import os
import json
import httpx
from sqlalchemy.orm import Session
from app import crud, models
import asyncio

def get_judge_provider(db: Session):
    # Fallback to local Ollama (assuming it exists and works)
    provider = db.query(models.Provider).filter(models.Provider.type == "openai_compatible").first()
    return provider

async def generate_recommendation_async(run_id: int, db: Session):
    run = crud.get_run(db, run_id)
    if not run:
        return "Run not found."
        
    requests = crud.get_run_requests(db, run_id)
    
    # Aggregate data
    stats = {}
    for r in requests:
        name = r.provider.name
        if name not in stats:
            stats[name] = {"completed": 0, "failed": 0, "ttft": [], "speed": []}
        if r.status == "SUCCESS":
            stats[name]["completed"] += 1
            if r.first_token_time and r.start_time:
                stats[name]["ttft"].append((r.first_token_time - r.start_time) / 1000.0)
            if r.output_tokens > 0 and r.finish_time and r.first_token_time:
                stats[name]["speed"].append(r.output_tokens / ((r.finish_time - r.first_token_time) / 1000000.0))
        else:
            stats[name]["failed"] += 1
            
    summary_lines = []
    for p, s in stats.items():
        avg_ttft = sum(s["ttft"])/len(s["ttft"]) if s["ttft"] else 0
        avg_speed = sum(s["speed"])/len(s["speed"]) if s["speed"] else 0
        summary_lines.append(f"- {p}: {s['completed']} success, {s['failed']} failed. Avg TTFT: {avg_ttft:.0f}ms. Avg Speed: {avg_speed:.1f} tokens/s.")
        
    prompt = f"You are an expert AI architect. Analyze these LLM runtime benchmark results:\n\nModel Tested: {run.config.model.name}\nResults:\n" + "\n".join(summary_lines) + "\n\nWrite a concise executive recommendation (2-3 paragraphs max) outlining which provider is best for local development (ease of use) vs production deployment (throughput/latency). Use markdown."

    judge = get_judge_provider(db)
    if not judge:
        return "No OpenAI-compatible provider found to generate AI recommendation."
        
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            res = await client.post(
                f"{judge.base_url}/chat/completions",
                json={
                    "model": "qwen2.5:latest",
                    "messages": [
                        {"role": "system", "content": "You are a highly analytical AI engineer."},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.2,
                    "max_tokens": 300
                }
            )
            data = res.json()
            return data["choices"][0]["message"]["content"]
    except Exception as e:
        return f"Failed to generate recommendation. Is your local AI provider running? Error: {str(e)}"
