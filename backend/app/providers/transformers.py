import asyncio
import time
from typing import AsyncIterator, Optional
from app.providers.base import InferenceProvider, GenerationResult

# Deferred imports to avoid loading heavy packages at startup if not used
transformers_available = False
try:
    import torch
    import transformers
    from transformers import AutoModelForCausalLM, AutoTokenizer, TextIteratorStreamer
    from threading import Thread
    transformers_available = True
except ImportError:
    pass

class TransformersProvider(InferenceProvider):
    def __init__(self, provider_id: int, name: str, base_url: str, api_key: Optional[str] = None, settings: Optional[dict] = None):
        super().__init__(provider_id, name, base_url, api_key, settings)
        self.loaded_models = {}

    async def health_check(self) -> bool:
        # Transformers direct execution is available if libraries are installed
        return transformers_available

    async def get_models(self) -> list[str]:
        # Direct execution requires specifying model path/ID. We list currently loaded or common local models.
        if not transformers_available:
            return []
        return list(self.loaded_models.keys()) + ["Qwen/Qwen2.5-0.5B-Instruct"]

    async def _get_model_and_tokenizer(self, model_name: str):
        if not transformers_available:
            raise ImportError("Hugging Face 'transformers' and 'torch' are not installed on this system.")

        if model_name not in self.loaded_models:
            # Load tokenizer and model in thread to avoid blocking loop
            def load():
                tokenizer = AutoTokenizer.from_pretrained(model_name)
                # Load in float16 or bfloat16 if GPU is available, else CPU float32
                device = "cuda" if torch.cuda.is_available() else "cpu"
                torch_dtype = torch.float16 if device == "cuda" else torch.float32
                
                model = AutoModelForCausalLM.from_pretrained(
                    model_name,
                    device_map="auto" if device == "cuda" else None,
                    torch_dtype=torch_dtype
                )
                if device == "cpu":
                    model = model.to("cpu")
                    
                return model, tokenizer

            model, tokenizer = await asyncio.to_thread(load)
            self.loaded_models[model_name] = (model, tokenizer)

        return self.loaded_models[model_name]

    async def generate(self, model: str, prompt: str, system_prompt: Optional[str], options: dict) -> GenerationResult:
        if not transformers_available:
            return GenerationResult(
                text="", prompt_tokens=0, output_tokens=0, total_tokens=0,
                total_time_ms=0, error="Hugging Face 'transformers' or 'torch' package not installed.",
                token_count_source="unknown"
            )

        start_time_us = time.time_ns() // 1000
        try:
            model_obj, tokenizer_obj = await self._get_model_and_tokenizer(model)
            
            full_prompt = f"<|im_start|>system\n{system_prompt or 'You are a helpful assistant.'}<|im_end|>\n<|im_start|>user\n{prompt}<|im_end|>\n<|im_start|>assistant\n"
            
            def run_inference():
                inputs = tokenizer_obj(full_prompt, return_tensors="pt")
                input_ids = inputs.input_ids.to(model_obj.device)
                
                gen_opts = {
                    "max_new_tokens": options.get("max_tokens", 128),
                    "temperature": max(options.get("temperature", 0.7), 0.01),
                    "top_p": options.get("top_p", 0.9),
                    "do_sample": options.get("temperature", 0.7) > 0.0
                }
                if "seed" in options:
                    torch.manual_seed(options["seed"])
                    
                outputs = model_obj.generate(input_ids, **gen_opts)
                # Slice outputs to ignore input tokens
                generated_ids = outputs[0][input_ids.shape[-1]:]
                generated_text = tokenizer_obj.decode(generated_ids, skip_special_tokens=True)
                
                return generated_text, len(input_ids[0]), len(generated_ids)

            text, prompt_len, output_len = await asyncio.to_thread(run_inference)
            finish_time_us = time.time_ns() // 1000
            
            return GenerationResult(
                text=text,
                prompt_tokens=prompt_len,
                output_tokens=output_len,
                total_tokens=prompt_len + output_len,
                ttft_ms=None,
                total_time_ms=(finish_time_us - start_time_us) / 1000.0,
                first_token_time=None,
                finish_time=finish_time_us,
                token_count_source="tokenizer"
            )

        except Exception as e:
            return GenerationResult(
                text="", prompt_tokens=0, output_tokens=0, total_tokens=0,
                total_time_ms=(time.time_ns() // 1000 - start_time_us) / 1000.0,
                error=str(e), token_count_source="unknown"
            )

    async def generate_stream(self, model: str, prompt: str, system_prompt: Optional[str], options: dict) -> AsyncIterator[dict]:
        if not transformers_available:
            yield {
                "choices": [],
                "error": "Hugging Face 'transformers' or 'torch' package not installed.",
                "is_first": False,
                "is_done": True
            }
            return

        start_time_us = time.time_ns() // 1000
        try:
            model_obj, tokenizer_obj = await self._get_model_and_tokenizer(model)
            
            full_prompt = f"<|im_start|>system\n{system_prompt or 'You are a helpful assistant.'}<|im_end|>\n<|im_start|>user\n{prompt}<|im_end|>\n<|im_start|>assistant\n"
            
            inputs = tokenizer_obj(full_prompt, return_tensors="pt")
            input_ids = inputs.input_ids.to(model_obj.device)
            prompt_len = len(input_ids[0])
            
            streamer = TextIteratorStreamer(tokenizer_obj, skip_prompt=True, skip_special_tokens=True)
            
            gen_opts = {
                "max_new_tokens": options.get("max_tokens", 128),
                "temperature": max(options.get("temperature", 0.7), 0.01),
                "top_p": options.get("top_p", 0.9),
                "do_sample": options.get("temperature", 0.7) > 0.0,
                "streamer": streamer
            }
            if "seed" in options:
                torch.manual_seed(options["seed"])

            # Run generate in thread
            def run():
                try:
                    model_obj.generate(input_ids, **gen_opts)
                except Exception:
                    pass

            thread = Thread(target=run)
            thread.start()

            first_token_time_us = None
            ttft_ms = None
            full_text = ""
            output_tokens = 0

            # Yield streamed text as they arrive in streamer queue
            for chunk_text in streamer:
                if not chunk_text:
                    continue
                output_tokens += len(tokenizer_obj.encode(chunk_text))
                full_text += chunk_text
                
                if first_token_time_us is None:
                    first_token_time_us = time.time_ns() // 1000
                    ttft_ms = (first_token_time_us - start_time_us) / 1000.0
                    yield {
                        "choices": [{"delta": {"content": chunk_text}}],
                        "ttft_ms": ttft_ms,
                        "first_token_time": first_token_time_us,
                        "is_first": True,
                        "is_done": False
                    }
                else:
                    yield {
                        "choices": [{"delta": {"content": chunk_text}}],
                        "is_first": False,
                        "is_done": False
                    }
                    
            finish_time_us = time.time_ns() // 1000
            total_time_ms = (finish_time_us - start_time_us) / 1000.0
            
            yield {
                "choices": [{"delta": {"content": ""}}],
                "text": full_text,
                "prompt_tokens": prompt_len,
                "output_tokens": output_tokens,
                "total_tokens": prompt_len + output_tokens,
                "ttft_ms": ttft_ms,
                "total_time_ms": total_time_ms,
                "first_token_time": first_token_time_us,
                "finish_time": finish_time_us,
                "is_first": False,
                "is_done": True,
                "token_count_source": "tokenizer"
            }
            
        except Exception as e:
            yield {
                "choices": [],
                "error": str(e),
                "is_first": False,
                "is_done": True
            }
        finally:
            # Join thread to prevent leaking
            await asyncio.to_thread(thread.join, timeout=5)
# Note: In a fully sandboxed/local environment, if we run in mock mode or don't load huge weights, we avoid memory limits.
