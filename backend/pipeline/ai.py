"""Thin OpenAI wrapper: structured JSON output + token accounting."""

import json
import logging
import threading

from app import config

log = logging.getLogger(__name__)

# USD per 1M tokens (input, output), for the cost estimate in logs only.
PRICES = {
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4.1-mini": (0.40, 1.60),
    "gpt-4.1-nano": (0.10, 0.40),
    "gpt-5-mini": (0.25, 2.00),
    "gpt-5-nano": (0.05, 0.40),
}


class AIUnavailable(Exception):
    pass


class Usage:
    def __init__(self) -> None:
        self.prompt = 0
        self.completion = 0
        self.calls = 0
        self._lock = threading.Lock()

    def add(self, prompt: int, completion: int) -> None:
        with self._lock:
            self.prompt += prompt
            self.completion += completion
            self.calls += 1

    @property
    def total(self) -> int:
        return self.prompt + self.completion

    def cost_usd(self, model: str) -> float | None:
        price = next((p for m, p in PRICES.items() if model.startswith(m)), None)
        if not price:
            return None
        return (self.prompt * price[0] + self.completion * price[1]) / 1_000_000


_client = None


def client():
    global _client
    if not config.OPENAI_API_KEY:
        raise AIUnavailable("OPENAI_API_KEY is not set")
    if _client is None:
        from openai import OpenAI

        _client = OpenAI(api_key=config.OPENAI_API_KEY, timeout=60, max_retries=2)
    return _client


def chat_json(system: str, user: str, schema: dict, schema_name: str, usage: Usage,
              max_tokens: int = 800) -> dict:
    """One structured-output call. Raises on failure; callers decide what to do."""
    model = config.OPENAI_MODEL
    kwargs = {
        "model": model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "response_format": {
            "type": "json_schema",
            "json_schema": {"name": schema_name, "schema": schema, "strict": True},
        },
    }
    # Reasoning models (gpt-5*, o*) take max_completion_tokens and no temperature.
    if model.startswith(("gpt-5", "o1", "o3", "o4")):
        kwargs["max_completion_tokens"] = max_tokens * 4
        if model.startswith("gpt-5"):
            kwargs["reasoning_effort"] = "minimal"
    else:
        kwargs["max_tokens"] = max_tokens
        kwargs["temperature"] = 0
    resp = client().chat.completions.create(**kwargs)
    if resp.usage:
        usage.add(resp.usage.prompt_tokens or 0, resp.usage.completion_tokens or 0)
    content = resp.choices[0].message.content
    if not content:
        raise ValueError(f"empty response (finish_reason={resp.choices[0].finish_reason})")
    return json.loads(content)
