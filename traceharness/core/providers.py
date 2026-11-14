"""Model back-ends. Zero third-party dependencies: plain HTTPS via urllib.

  OpenAIProvider     any OpenAI-compatible chat-completions endpoint
                     (OpenAI, OpenRouter, Together, vLLM, Ollama, ...);
                     --provider openrouter selects it with the OpenRouter base URL,
                     OPENROUTER_API_KEY, and per-call cost reported by the endpoint
  AnthropicProvider  Anthropic Messages API
  MockProvider       offline, scripted, stochastic agent (see mock.py)

All providers speak the same internal message format (OpenAI chat style):
  {"role": "system"|"user"|"assistant"|"tool", "content": str,
   "tool_calls": [{"id", "name", "arguments": dict}],   # assistant only
   "tool_call_id": str}                                 # tool only
"""
from __future__ import annotations
import json, os, time, urllib.request, urllib.error
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict


@dataclass
class ChatResponse:
    text: str
    tool_calls: list[ToolCall]
    input_tokens: int
    output_tokens: int
    finish_reason: str = ""
    latency_ms: int = 0
    raw: dict = field(default_factory=dict)
    cost_usd: Optional[float] = None       # set when the endpoint reports the charge itself (OpenRouter)
    # Who actually answered. A router such as OpenRouter can serve one model identifier from several
    # upstream providers, and the same identifier can change behaviour when the route changes; without
    # these two fields a ledger cannot tell a model effect from a serving effect. None = not reported.
    served_by: Optional[str] = None        # upstream provider named by the endpoint (OpenRouter's `provider`)
    response_model: Optional[str] = None   # model identifier echoed by the endpoint (may carry a snapshot date)
    # The sampling parameters that were actually SENT on this call. A harness can ask for
    # temperature 0, but a reasoning model that rejects the parameter runs at its own default;
    # recording what went over the wire keeps the ledger from claiming a setting it never applied.
    sent_temperature: Optional[float] = None   # None = not sent (the endpoint used its default)
    sent_seed: Optional[int] = None            # None = not sent


# USD per million tokens (input, output). Edit freely; prices change.
# Sources checked Sept 2026: Anthropic pricing page; OpenAI figures via third-party trackers; the rest from
# OpenRouter's public model list (2 Sep 2026). Keys are matched as substrings of the model id, longest first,
# so "anthropic/claude-sonnet-5" and "claude-sonnet-5" both resolve. With --provider openrouter the endpoint
# reports the exact charge per call and this table is only a fallback.
PRICES = {
    "claude-fable-5-1": (10.0, 50.0),   # https://platform.claude.com/docs/en/about-claude/pricing
    "claude-sonnet-5": (2.0, 10.0),
    "claude-sonnet-4": (3.0, 15.0),
    "claude-haiku-4": (1.0, 5.0),
    "claude-opus-5": (5.0, 25.0),
    "claude-opus-4": (5.0, 25.0),
    "gpt-5.6-terra": (2.5, 15.0),
    "gpt-5.6-luna": (0.2, 1.2),
    "gemini-2.5-flash-lite": (0.1, 0.4),
    "gemini-3.8-flash": (0.75, 3.75),
    "qwen3.8-27b": (0.42, 3.0),
    "gpt-5.6-sol": (1.25, 10.0),
    "gpt-5.4-mini": (0.75, 4.5),
    "gpt-5-mini": (0.25, 2.0),
    "gpt-5": (1.25, 10.0),
    "gpt-4.1-mini": (0.4, 1.6),
    "gpt-4.1": (2.0, 8.0),
    "gpt-4o-mini": (0.15, 0.6),
    "gpt-4o": (2.5, 10.0),
    "glm-5.3-flash": (0.075, 0.25),
    "glm-5.3": (1.4, 4.4),
    "glm-5.2": (0.97, 3.04),
    "gemini-3.7-flash": (0.75, 3.75),
    "qwen3.8-max": (2.0, 6.0),
    "kimi-k3": (3.0, 15.0),
    "grok-4.6": (2.0, 6.0),
    "mock-weak": (0.25, 1.25),
    "mock": (1.0, 5.0),
}


def price_for(model: str, override: Optional[tuple] = None) -> tuple[float, float]:
    if override:
        return tuple(override)
    m = model.lower()
    for key in sorted(PRICES, key=len, reverse=True):
        if key in m:
            return PRICES[key]
    return (2.0, 10.0)  # unknown model: mid-tier guess; the capture writer records cost_priced=False on the run's end span


# Prompt-cache pricing, as multipliers of a model's INPUT price: (cache read, cache write).
# Anthropic bills a cache read at 0.1x and a 5-minute cache write at 1.25x the base input rate.
# Matched by substring, like PRICES. These are price-table facts: change them here, never in a caller.
CACHE_MULTIPLIERS = {
    "claude-fable-5-1": (0.025, 1.25),   # Fable 5.1 bills cache reads at 0.025x (Anthropic prompt caching docs)
    "claude": (0.10, 1.25),
}


def cache_multipliers(model: str) -> tuple[float, float]:
    m = (model or "").lower()
    for key in sorted(CACHE_MULTIPLIERS, key=len, reverse=True):
        if key in m:
            return CACHE_MULTIPLIERS[key]
    return (1.0, 1.0)   # unknown provider: bill cached tokens as ordinary input rather than invent a discount


def is_priced(model: str) -> bool:
    """True when `model` matches a PRICES entry; False when price_for would use its mid-tier guess."""
    m = (model or "").lower()
    return any(key in m for key in PRICES)


def cost_usd(model: str, input_tokens: int, output_tokens: int, override=None,
             cache_read_tokens: int = 0, cache_write_tokens: int = 0) -> float:
    pi, po = price_for(model, override)
    read_mult, write_mult = cache_multipliers(model)
    return (input_tokens / 1e6 * pi + output_tokens / 1e6 * po
            + cache_read_tokens / 1e6 * pi * read_mult
            + cache_write_tokens / 1e6 * pi * write_mult)


def _post_json(url: str, headers: dict, payload: dict, timeout: int = 120, retries: int = 4) -> dict:
    data = json.dumps(payload).encode()
    last = None
    for attempt in range(retries):
        req = urllib.request.Request(url, data=data, headers={**headers, "Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode())
        except urllib.error.HTTPError as e:
            body = e.read().decode(errors="replace")
            last = RuntimeError(f"HTTP {e.code}: {body[:500]}")
            if e.code in (429, 500, 502, 503, 529):
                time.sleep(2 ** attempt)
                continue
            raise last
        except (urllib.error.URLError, TimeoutError) as e:
            last = e
            time.sleep(2 ** attempt)
    raise RuntimeError(f"request failed after {retries} attempts: {last}")


class Provider:
    name = "base"

    def __init__(self, model: str, temperature: float = 0.0, price=None):
        self.model, self.temperature, self.price = model, temperature, price

    def chat(self, messages: list[dict], tools: list[dict], max_tokens: int = 2048) -> ChatResponse:
        raise NotImplementedError

    def cost(self, inp: int, out: int) -> float:
        return cost_usd(self.model, inp, out, self.price)


# ----------------------------------------------------------------------------
class OpenAIProvider(Provider):
    name = "openai"

    def __init__(self, model: str, temperature: float = 0.0, price=None, api_key: Optional[str] = None,
                 base_url: Optional[str] = None, route: Optional[list] = None):
        super().__init__(model, temperature, price)
        self.base_url = (base_url or os.environ.get("OPENAI_BASE_URL") or "https://api.openai.com/v1").rstrip("/")
        self.openrouter = "openrouter.ai" in self.base_url
        # OpenRouter only: the upstream providers a run may be served by, in order, with fallbacks
        # to any other provider switched off. Pinning the route removes one source of run-to-run
        # variation that has nothing to do with the model or the harness.
        self.route = [r.strip() for r in (route or []) if r and r.strip()]
        if self.route and not self.openrouter:
            raise ValueError("--route pins OpenRouter's upstream provider; it has no meaning for another endpoint")
        self.seed: Optional[int] = None
        self.seed_supported = True    # cleared when the endpoint rejects `seed`; later calls omit it
        self.api_key = api_key or (os.environ.get("OPENROUTER_API_KEY", "") if self.openrouter else "") or os.environ.get("OPENAI_API_KEY", "")
        if not self.api_key and ("api.openai.com" in self.base_url or self.openrouter):
            raise RuntimeError("OPENROUTER_API_KEY is not set" if self.openrouter else "OPENAI_API_KEY is not set")

    def reseed(self, seed: Optional[int]):
        """The run's seed, sent as the OpenAI `seed` parameter (OpenRouter forwards it to providers
        that support it). It asks for best-effort determinism; it does not guarantee it."""
        self.seed = None if seed is None else int(seed) % (2 ** 31)

    def chat(self, messages, tools, max_tokens=2048) -> ChatResponse:
        oai_msgs = []
        for m in messages:
            if m["role"] == "assistant":
                mm = {"role": "assistant", "content": m.get("content") or None}
                if m.get("tool_calls"):
                    mm["tool_calls"] = [{"id": tc["id"], "type": "function",
                                         "function": {"name": tc["name"], "arguments": json.dumps(tc["arguments"])}}
                                        for tc in m["tool_calls"]]
                oai_msgs.append(mm)
            elif m["role"] == "tool":
                oai_msgs.append({"role": "tool", "tool_call_id": m["tool_call_id"], "content": m["content"]})
            else:
                oai_msgs.append({"role": m["role"], "content": m["content"]})
        payload = {"model": self.model, "messages": oai_msgs,
                   "tools": [{"type": "function", "function": t} for t in tools]}
        if self.openrouter:
            payload["max_tokens"] = max_tokens
            payload["usage"] = {"include": True}          # OpenRouter returns the exact charge per call
            if self.route:
                payload["provider"] = {"order": list(self.route), "allow_fallbacks": False}
        else:
            payload["max_completion_tokens"] = max_tokens
        # Reasoning models reject a temperature parameter; only send it when non-default.
        bare = self.model.split("/")[-1]
        sent_t = None
        if self.temperature not in (None, 1.0) and not bare.startswith(("o1", "o3", "o4", "gpt-5")):
            payload["temperature"] = self.temperature
            sent_t = float(self.temperature)
        if self.seed is not None and self.seed_supported:
            payload["seed"] = self.seed
        headers = {"Authorization": f"Bearer {self.api_key}"}
        if self.openrouter:
            headers.update({"HTTP-Referer": "https://github.com/aura-lab-wm/traceharness", "X-Title": "traceharness"})
        t0 = time.time()
        try:
            r = _post_json(f"{self.base_url}/chat/completions", headers, payload)
        except RuntimeError as e:
            # An endpoint that does not accept `seed` answers 400 or 422 naming it. Retry once without it and
            # stop sending it; the span then records sent_seed=None, which is what went over the wire.
            if "seed" not in payload or not str(e).startswith(("HTTP 400", "HTTP 422")) or "seed" not in str(e).lower():
                raise
            self.seed_supported = False
            payload.pop("seed")
            r = _post_json(f"{self.base_url}/chat/completions", headers, payload)
        choice = r["choices"][0]
        msg = choice["message"]
        calls = []
        for tc in msg.get("tool_calls") or []:
            try:
                args = json.loads(tc["function"].get("arguments") or "{}")
            except json.JSONDecodeError:
                args = {"_raw": tc["function"].get("arguments")}
            calls.append(ToolCall(tc["id"], tc["function"]["name"], args))
        usage = r.get("usage", {}) or {}
        reported = usage.get("cost")
        return ChatResponse(text=msg.get("content") or "", tool_calls=calls,
                            input_tokens=usage.get("prompt_tokens", 0), output_tokens=usage.get("completion_tokens", 0),
                            finish_reason=choice.get("finish_reason", ""), latency_ms=int((time.time() - t0) * 1000), raw=r,
                            cost_usd=float(reported) if reported is not None else None,
                            served_by=(r.get("provider") or None) if isinstance(r.get("provider"), str) else None,
                            response_model=(r.get("model") or None) if isinstance(r.get("model"), str) else None,
                            sent_temperature=sent_t, sent_seed=payload.get("seed"))


# ----------------------------------------------------------------------------
class AnthropicProvider(Provider):
    name = "anthropic"

    def __init__(self, model: str, temperature: float = 0.0, price=None, api_key: Optional[str] = None):
        super().__init__(model, temperature, price)
        self.api_key = api_key or os.environ.get("ANTHROPIC_API_KEY", "")
        if not self.api_key:
            raise RuntimeError("ANTHROPIC_API_KEY is not set")

    def chat(self, messages, tools, max_tokens=2048) -> ChatResponse:
        system = "\n\n".join(m["content"] for m in messages if m["role"] == "system")
        conv = []
        for m in messages:
            if m["role"] == "system":
                continue
            if m["role"] == "assistant":
                blocks = []
                if m.get("content"):
                    blocks.append({"type": "text", "text": m["content"]})
                for tc in m.get("tool_calls") or []:
                    blocks.append({"type": "tool_use", "id": tc["id"], "name": tc["name"], "input": tc["arguments"]})
                conv.append({"role": "assistant", "content": blocks or [{"type": "text", "text": "(no output)"}]})
            elif m["role"] == "tool":
                block = {"type": "tool_result", "tool_use_id": m["tool_call_id"], "content": m["content"]}
                if conv and conv[-1]["role"] == "user" and isinstance(conv[-1]["content"], list) \
                        and conv[-1]["content"] and conv[-1]["content"][0].get("type") == "tool_result":
                    conv[-1]["content"].append(block)
                else:
                    conv.append({"role": "user", "content": [block]})
            else:
                conv.append({"role": "user", "content": m["content"]})
        payload = {"model": self.model, "max_tokens": max_tokens, "system": system, "messages": conv,
                   "tools": [{"name": t["name"], "description": t["description"], "input_schema": t["parameters"]} for t in tools]}
        if self.temperature is not None:
            payload["temperature"] = self.temperature
        t0 = time.time()
        r = _post_json("https://api.anthropic.com/v1/messages",
                       {"x-api-key": self.api_key, "anthropic-version": "2023-06-01"}, payload)
        text, calls = [], []
        for b in r.get("content", []):
            if b["type"] == "text":
                text.append(b["text"])
            elif b["type"] == "tool_use":
                calls.append(ToolCall(b["id"], b["name"], b.get("input") or {}))
        u = r.get("usage", {})
        inp = u.get("input_tokens", 0) + u.get("cache_read_input_tokens", 0) + u.get("cache_creation_input_tokens", 0)
        return ChatResponse(text="\n".join(text), tool_calls=calls, input_tokens=inp, output_tokens=u.get("output_tokens", 0),
                            finish_reason=r.get("stop_reason", ""), latency_ms=int((time.time() - t0) * 1000), raw=r,
                            served_by="anthropic", response_model=r.get("model") if isinstance(r.get("model"), str) else None,
                            sent_temperature=float(self.temperature) if self.temperature is not None else None)


# ----------------------------------------------------------------------------
def make_provider(kind: str, model: str, temperature: float = 0.0, price=None, seed: Optional[int] = None, **kw) -> Provider:
    kind = kind.lower()
    if kind == "openrouter":
        kw.setdefault("base_url", "https://openrouter.ai/api/v1")
        return OpenAIProvider(model, temperature, price, **kw)
    if kw.get("route") and kind not in ("openrouter", "openai"):
        # kind "openai" is let through: OpenAIProvider accepts a route when base_url is OpenRouter
        # and raises its own error for any other endpoint.
        raise ValueError("--route pins OpenRouter's upstream provider; use it with --provider openrouter")
    kw = {k: v for k, v in kw.items() if not (k == "route" and not v)}
    if kind == "openai":
        return OpenAIProvider(model, temperature, price, **kw)
    if kind == "anthropic":
        return AnthropicProvider(model, temperature, price, **kw)
    if kind == "mock":
        from .mock import MockProvider
        return MockProvider(model or "mock", temperature, price, seed=seed)
    raise ValueError(f"unknown provider kind: {kind}")
