import httpx
import json
import time
from typing import AsyncIterator, Optional
from app.providers.base import InferenceProvider, GenerationResult

class OpenAICompatibleProvider(InferenceProvider):
    def _get_url(self, path: str) -> str:
        base = self.base_url.rstrip("/")
        # Make sure we don't double '/v1' or duplicate paths
        if path.startswith("/"):
            path = path[1:]
        return f"{base}/{path}"

    async def health_check(self) -> bool:
        res = await self.health_check_detailed()
        return res["online"]
        
    async def health_check_detailed(self) -> dict:
        is_local = "localhost" in self.base_url or "127.0.0.1" in self.base_url
        if not self.api_key and not is_local:
            return {"online": False, "error": "Missing API Key"}

        try:
            async with httpx.AsyncClient(timeout=3.0) as client:
                url = self._get_url("models")
                response = await client.get(url, headers=self._get_headers())
                if response.status_code == 200:
                    return {"online": True, "error": None}
                else:
                    try:
                        err_json = response.json()
                        err_msg = err_json.get("error", {}).get("message", response.text) if isinstance(err_json.get("error"), dict) else err_json.get("error", response.text)
                    except:
                        err_msg = response.text
                    return {"online": False, "error": f"HTTP {response.status_code}: {err_msg[:200]}"}
        except Exception as e:
            return {"online": False, "error": str(e)}

    def _get_headers(self) -> dict:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    async def get_models(self) -> list[str]:
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                url = self._get_url("models")
                response = await client.get(url, headers=self._get_headers())
                if response.status_code == 200:
                    data = response.json()
                    # OpenAI standard is {"data": [{"id": "model-id"}]}
                    models = data.get("data", [])
                    if isinstance(models, list):
                        parsed = [m.get("id") for m in models if isinstance(m, dict) and "id" in m]
                        if "api.mistral.ai" in self.base_url:
                            parsed = [m for m in parsed if "-embed" not in m and "-v0." not in m and "agent" not in m and "fim" not in m and "unknown" not in m]
                        return parsed
        except Exception:
            pass
        return []

    def _convert_options(self, options: dict) -> dict:
        api_opts = {}
        if "temperature" in options and options["temperature"] is not None:
            api_opts["temperature"] = options["temperature"]
        if "top_p" in options and options["top_p"] is not None:
            api_opts["top_p"] = options["top_p"]
        if "seed" in options and options["seed"] is not None:
            # Mistral API does not accept the 'seed' parameter
            if "mistral.ai" not in self.base_url:
                api_opts["seed"] = options["seed"]
        if "max_tokens" in options and options["max_tokens"] is not None:
            api_opts["max_tokens"] = options["max_tokens"]
        if "stop_sequences" in options and options["stop_sequences"]:
            if isinstance(options["stop_sequences"], str):
                api_opts["stop"] = [s.strip() for s in options["stop_sequences"].split(",") if s.strip()]
            elif isinstance(options["stop_sequences"], list):
                api_opts["stop"] = options["stop_sequences"]
        return api_opts

    async def generate(self, model: str, prompt: str, system_prompt: Optional[str], options: dict) -> GenerationResult:
        start_time_us = time.time_ns() // 1000
        
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        req_body = {
            "model": model,
            "messages": messages,
            "stream": False,
            **self._convert_options(options)
        }

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                url = self._get_url("chat/completions")
                response = await client.post(
                    url,
                    json=req_body,
                    headers=self._get_headers()
                )
                
                finish_time_us = time.time_ns() // 1000
                total_time_ms = (finish_time_us - start_time_us) / 1000.0
                
                if response.status_code != 200:
                    raise Exception(f"OpenAI server returned {response.status_code}: {response.text}")
                
                data = response.json()
                choice = data["choices"][0]
                text = choice["message"]["content"]
                
                usage = data.get("usage", {})
                prompt_tokens = usage.get("prompt_tokens", 0)
                output_tokens = usage.get("completion_tokens", 0)
                
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
                    token_count_source="provider" if usage.get("prompt_tokens") else "estimated"
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
        # AUTO-REMAP MISTRAL MODELS TO PREVENT 400 ERRORS
        if "mistral.ai" in self.base_url and ("mistral-7b-v" in model or "-code" in model or "-embed" in model):
            model = "open-mistral-7b"

        start_time_us = time.time_ns() // 1000
        
        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append({"role": "user", "content": prompt})

        req_body = {
            "model": model,
            "messages": messages,
            "stream": True,
            **self._convert_options(options)
        }

        first_token_time_us = None
        ttft_ms = None
        full_text = ""
        prompt_tokens = 0
        output_tokens = 0
        token_count_source = "estimated"

        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                url = self._get_url("chat/completions")
                async with client.stream("POST", url, json=req_body, headers=self._get_headers()) as response:
                    if response.status_code != 200:
                        error_text = await response.aread()
                        raise Exception(f"OpenAI compatible stream error {response.status_code}: {error_text.decode('utf-8', errors='ignore')}")
                    
                    async for line in response.aiter_lines():
                        if not line:
                            continue
                        if line.startswith("data: "):
                            data_str = line[len("data: "):].strip()
                        else:
                            data_str = line.strip()
                            
                        if data_str == "[DONE]":
                            break
                        
                        try:
                            data = json.loads(data_str)
                        except json.JSONDecodeError:
                            continue
                        
                        # Extract usage if present in chunk
                        if "usage" in data and data["usage"]:
                            prompt_tokens = data["usage"].get("prompt_tokens", 0)
                            output_tokens = data["usage"].get("completion_tokens", 0)
                            token_count_source = "provider"
                            
                        choices = data.get("choices", [])
                        if not choices:
                            continue
                            
                        delta = choices[0].get("delta", {})
                        chunk_text = delta.get("content") or ""
                        
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
