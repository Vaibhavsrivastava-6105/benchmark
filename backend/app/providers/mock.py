import asyncio
import time
import random
import json
from typing import AsyncIterator, Optional
from app.providers.base import InferenceProvider, GenerationResult

class MockProvider(InferenceProvider):
    async def health_check(self) -> bool:
        await asyncio.sleep(0.1)
        return True

    async def get_models(self) -> list[str]:
        await asyncio.sleep(0.1)
        return [
            "qwen2.5-7b-instruct",
            "llama3-8b-instruct",
            "mistral-7b-v0.3",
            "phi3-medium"
        ]

    def _get_mock_speeds(self, model: str) -> tuple[float, float, float]:
        """
        Returns (mean_ttft_ms, mean_tokens_per_sec, vram_gb) based on provider name.
        Allows mimicking the specific speed characteristics of different engines.
        """
        name_lower = self.name.lower()
        if "vllm" in name_lower:
            return (150.0, 75.0, 6.2)
        elif "llamacpp" in name_lower or "llama.cpp" in name_lower:
            return (220.0, 48.0, 4.8)
        elif "ollama" in name_lower:
            return (290.0, 42.0, 5.1)
        elif "transformers" in name_lower:
            return (400.0, 25.0, 7.8)
        else:
            # Default mock speeds
            return (200.0, 50.0, 5.5)

    async def generate(self, model: str, prompt: str, system_prompt: Optional[str], options: dict) -> GenerationResult:
        start_time_us = time.time_ns() // 1000
        
        # Determine speeds
        mean_ttft, mean_tps, _ = self._get_mock_speeds(model)
        
        # Simulate work
        output_len = random.randint(80, 150)
        ttft_s = (mean_ttft + random.uniform(-30, 30)) / 1000.0
        generation_time_s = output_len / (mean_tps + random.uniform(-5, 5))
        total_time_s = ttft_s + generation_time_s
        
        await asyncio.sleep(total_time_s)
        
        # Check prompt for structured JSON expectations or matching
        response_text = self._generate_text_by_prompt(prompt)
        
        finish_time_us = time.time_ns() // 1000
        first_token_time_us = start_time_us + int(ttft_s * 1000000)
        
        prompt_tokens = len(prompt.split()) + 10
        output_tokens = len(response_text.split())
        
        return GenerationResult(
            text=response_text,
            prompt_tokens=prompt_tokens,
            output_tokens=output_tokens,
            total_tokens=prompt_tokens + output_tokens,
            ttft_ms=None,  # Non-streaming doesn't calculate TTFT
            total_time_ms=total_time_s * 1000.0,
            first_token_time=None,
            finish_time=finish_time_us,
            token_count_source="tokenizer"
        )

    async def generate_stream(self, model: str, prompt: str, system_prompt: Optional[str], options: dict) -> AsyncIterator[dict]:
        start_time_us = time.time_ns() // 1000
        mean_ttft, mean_tps, _ = self._get_mock_speeds(model)
        
        # Calculate timing
        ttft_s = (mean_ttft + random.uniform(-20, 20)) / 1000.0
        
        # Wait for TTFT
        await asyncio.sleep(ttft_s)
        first_token_time_us = time.time_ns() // 1000
        ttft_ms_actual = (first_token_time_us - start_time_us) / 1000.0
        
        yield {
            "choices": [{"delta": {"content": ""}}],
            "ttft_ms": ttft_ms_actual,
            "first_token_time": first_token_time_us,
            "is_first": True,
            "is_done": False
        }
        
        response_text = self._generate_text_by_prompt(prompt)
        words = response_text.split(" ")
        
        # Streams words with token speed spacing
        tps = mean_tps + random.uniform(-3, 3)
        delay_per_word = 1.3 / tps  # Roughly 1.3 tokens per word
        
        current_text = ""
        for i, word in enumerate(words):
            word_part = word + (" " if i < len(words) - 1 else "")
            current_text += word_part
            await asyncio.sleep(delay_per_word)
            
            yield {
                "choices": [{"delta": {"content": word_part}}],
                "is_first": False,
                "is_done": False
            }
            
        finish_time_us = time.time_ns() // 1000
        total_time_ms = (finish_time_us - start_time_us) / 1000.0
        
        prompt_tokens = len(prompt.split()) + 10
        output_tokens = len(response_text.split())
        
        yield {
            "choices": [{"delta": {"content": ""}}],
            "text": response_text,
            "prompt_tokens": prompt_tokens,
            "output_tokens": output_tokens,
            "total_tokens": prompt_tokens + output_tokens,
            "ttft_ms": ttft_ms_actual,
            "total_time_ms": total_time_ms,
            "first_token_time": first_token_time_us,
            "finish_time": finish_time_us,
            "is_first": False,
            "is_done": True,
            "token_count_source": "provider"
        }

    def _generate_text_by_prompt(self, prompt: str) -> str:
        prompt_lower = prompt.lower()
        
        # Structured JSON prompts
        if "json" in prompt_lower or "schema" in prompt_lower:
            # Let's verify if we want to simulate some JSON reliability drops
            # Ollama: 98.2%, vLLM: 99.5%, llama.cpp: 97.8%, Transformers: 96.4%
            # If the provider name dictates, we can introduce a tiny likelihood of broken JSON
            name_lower = self.name.lower()
            roll = random.random()
            
            # Decide if we generate malformed JSON
            is_malformed = False
            if "transformers" in name_lower and roll > 0.96:
                is_malformed = True
            elif "llamacpp" in name_lower and roll > 0.98:
                is_malformed = True
            elif "ollama" in name_lower and roll > 0.98:
                is_malformed = True
                
            if is_malformed:
                return '{\n  "name": "JSON Failure Mock",\n  "error": "Forgot closing bracket'
                
            # Good structured JSON
            return json.dumps({
                "model_evaluation": {
                    "reasoning_steps": [
                        "Parsed user prompt correctly.",
                        "Identified target schema.",
                        "Formatted parameters accordingly."
                    ],
                    "score": round(random.uniform(85, 99), 1),
                    "verdict": "highly_capable"
                }
            }, indent=2)
            
        # Math prompts
        elif "37 * 48" in prompt_lower or "37*48" in prompt_lower:
            # Answer: 1776
            # Some providers might fail for variety
            roll = random.random()
            if roll > 0.95:
                return "The result of multiplying 37 by 48 is 1766."
            return "The product of 37 and 48 is 1776."
            
        # Coding prompts
        elif "code" in prompt_lower or "python" in prompt_lower or "function" in prompt_lower:
            return (
                "Here is the requested Python function:\n\n"
                "```python\n"
                "def add_numbers(a: int, b: int) -> int:\n"
                "    \"\"\"Return the sum of two integers.\"\"\"\n"
                "    return a + b\n"
                "```\n\n"
                "You can use this function to calculate sums in Python."
            )
            
        # Long Context or default reasoning
        else:
            return (
                "Based on the analysis of the prompt, the primary concepts involved include operational "
                "efficiency, software execution performance, and hardware optimization. When comparing "
                "various runtimes, throughput (measured in tokens per second) and time-to-first-token (TTFT) "
                "serve as critical telemetry indicators. In production workloads, low VRAM footprints enable "
                "higher batch sizes and concurrent requests."
            )
