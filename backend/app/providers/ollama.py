import httpx
import json
import time
from typing import AsyncIterator, Optional
from app.providers.base import InferenceProvider, GenerationResult

class OllamaProvider(InferenceProvider):
    async def health_check(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                response = await client.get(f"{self.base_url}/")
                return response.status_code == 200
        except Exception:
            return False

    async def get_models(self) -> list[str]:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{self.base_url}/api/tags")
                if response.status_code == 200:
                    data = response.json()
                    return [m["name"] for m in data.get("models", [])]
        except Exception:
            pass
        return []

    def _convert_options(self, options: dict) -> dict:
        """
        Maps standard settings to Ollama specific options.
        """
        ollama_opts = {}
        if "temperature" in options:
            ollama_opts["temperature"] = options["temperature"]
        if "top_p" in options:
            ollama_opts["top_p"] = options["top_p"]
        if "top_k" in options:
            ollama_opts["top_k"] = options["top_k"]
        if "seed" in options:
            ollama_opts["seed"] = options["seed"]
        if "stop_sequences" in options and options["stop_sequences"]:
            if isinstance(options["stop_sequences"], str):
                ollama_opts["stop"] = [s.strip() for s in options["stop_sequences"].split(",") if s.strip()]
            elif isinstance(options["stop_sequences"], list):
                ollama_opts["stop"] = options["stop_sequences"]
        return ollama_opts

    async def generate(self, model: str, prompt: str, system_prompt: Optional[str], options: dict) -> GenerationResult:
        start_time_us = time.time_ns() // 1000
        
        req_body = {
            "model": model,
            "prompt": prompt,
            "stream": False,
            "options": self._convert_options(options)
        }
        if system_prompt:
            req_body["system"] = system_prompt
        if "max_tokens" in options:
            req_body["options"]["num_predict"] = options["max_tokens"]

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    f"{self.base_url}/api/generate",
                    json=req_body
                )
                
                finish_time_us = time.time_ns() // 1000
                total_time_ms = (finish_time_us - start_time_us) / 1000.0
                
                if response.status_code != 200:
                    raise Exception(f"Ollama server returned status {response.status_code}: {response.text}")
                
                data = response.json()
                text = data.get("response", "")
                
                # Retrieve token counts from Ollama response
                prompt_tokens = data.get("prompt_eval_count", 0)
                output_tokens = data.get("eval_count", 0)
                
                # If 0, estimate it
                if prompt_tokens == 0:
                    prompt_tokens = len(prompt.split()) + 10
                if output_tokens == 0:
                    output_tokens = len(text.split())
                    
                return GenerationResult(
                    text=text,
                    prompt_tokens=prompt_tokens,
                    output_tokens=output_tokens,
                    total_tokens=prompt_tokens + output_tokens,
                    ttft_ms=None,
                    total_time_ms=total_time_ms,
                    first_token_time=None,
                    finish_time=finish_time_us,
                    token_count_source="provider" if data.get("prompt_eval_count") else "estimated"
                )
        except Exception as e:
            return GenerationResult(
                text="",
                prompt_tokens=0,
                output_tokens=0,
                total_tokens=0,
                total_time_ms=(time.time_ns() // 1000 - start_time_us) / 1000.0,
                error=str(e),
                token_count_source="unknown"
            )

    async def generate_stream(self, model: str, prompt: str, system_prompt: Optional[str], options: dict) -> AsyncIterator[dict]:
        start_time_us = time.time_ns() // 1000
        
        req_body = {
            "model": model,
            "prompt": prompt,
            "stream": True,
            "options": self._convert_options(options)
        }
        if system_prompt:
            req_body["system"] = system_prompt
        if "max_tokens" in options:
            req_body["options"]["num_predict"] = options["max_tokens"]

        first_token_time_us = None
        ttft_ms = None
        full_text = ""
        prompt_tokens = 0
        output_tokens = 0
        token_count_source = "estimated"

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                async with client.stream("POST", f"{self.base_url}/api/generate", json=req_body) as response:
                    if response.status_code != 200:
                        raise Exception(f"Ollama stream error {response.status_code}")
                    
                    async for line in response.aiter_lines():
                        if not line:
                            continue
                        
                        data = json.loads(line)
                        chunk_text = data.get("response", "")
                        
                        if chunk_text and first_token_time_us is None:
                            first_token_time_us = time.time_ns() // 1000
                            ttft_ms = (first_token_time_us - start_time_us) / 1000.0
                            yield {
                                "choices": [{"delta": {"content": chunk_text}}],
                                "ttft_ms": ttft_ms,
                                "first_token_time": first_token_time_us,
                                "is_first": True,
                                "is_done": False
                            }
                        elif chunk_text:
                            yield {
                                "choices": [{"delta": {"content": chunk_text}}],
                                "is_first": False,
                                "is_done": False
                            }
                        
                        full_text += chunk_text
                        
                        if data.get("done", False):
                            prompt_tokens = data.get("prompt_eval_count", 0)
                            output_tokens = data.get("eval_count", 0)
                            token_count_source = "provider" if data.get("prompt_eval_count") else "estimated"
                            break

            finish_time_us = time.time_ns() // 1000
            total_time_ms = (finish_time_us - start_time_us) / 1000.0
            
            if prompt_tokens == 0:
                prompt_tokens = len(prompt.split()) + 10
            if output_tokens == 0:
                output_tokens = len(full_text.split())
                
            yield {
                "choices": [{"delta": {"content": ""}}],
                "text": full_text,
                "prompt_tokens": prompt_tokens,
                "output_tokens": output_tokens,
                "total_tokens": prompt_tokens + output_tokens,
                "ttft_ms": ttft_ms,
                "total_time_ms": total_time_ms,
                "first_token_time": first_token_time_us,
                "finish_time": finish_time_us,
                "is_first": False,
                "is_done": True,
                "token_count_source": token_count_source
            }
            
        except Exception as e:
            yield {
                "choices": [],
                "error": str(e),
                "is_first": False,
                "is_done": True
            }
