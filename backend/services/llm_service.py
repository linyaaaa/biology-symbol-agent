"""
LLM 服务 - 调用火山引擎 Ark API 获取基因符号的 aliases
优化：连接池复用 + 超时控制 + 缓存
"""

import os
import json
import time
import httpx
from openai import OpenAI

# 从环境变量读取配置
ARK_API_KEY = os.getenv("ARK_API_KEY", "3266ee92-5d65-400d-95b2-7be87d48899a")
ARK_MODEL_ID = os.getenv("ARK_MODEL_ID", "glm-4-7-251222")
ARK_BASE_URL = os.getenv("ARK_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3")

# 使用 httpx 连接池复用 TCP 连接，避免每次请求重新建立连接
_http_client = httpx.Client(
    timeout=httpx.Timeout(30.0, connect=10.0),  # 总超时 30s，连接超时 10s
    limits=httpx.Limits(max_connections=10, max_keepalive_connections=5),
    http2=True,  # 启用 HTTP/2 多路复用
)

client = OpenAI(
    api_key=ARK_API_KEY,
    base_url=ARK_BASE_URL,
    http_client=_http_client,
)

# 精简 prompt
SYSTEM_PROMPT = """You are a gene nomenclature expert. Given a gene symbol, return a JSON array of all known aliases.
Rules: JSON array only. No explanation. Empty array if unknown.
Example: ["TP53","P53","tumor protein p53"]"""

# 内存缓存：{ gene_lower: {"aliases": [...], "timestamp": float} }
_cache: dict[str, dict] = {}
CACHE_TTL = 86400  # 24 小时


def get_gene_aliases(gene_symbol: str) -> list[str]:
    """获取基因别名（带缓存 + 连接池复用）"""
    if not ARK_API_KEY:
        raise ValueError("ARK_API_KEY is not set.")

    key = gene_symbol.strip().lower()
    if not key:
        return [gene_symbol]

    # 查缓存
    cached = _cache.get(key)
    if cached and (time.time() - cached["timestamp"]) < CACHE_TTL:
        return cached["aliases"]

    start = time.time()
    try:
        completion = client.chat.completions.create(
            model=ARK_MODEL_ID,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": key},
            ],
            temperature=0.1,
            max_tokens=200,
        )

        response_text = completion.choices[0].message.content.strip()
        aliases = _parse_aliases(response_text, gene_symbol)

        # 去重
        seen = set()
        unique = []
        for a in aliases:
            a = a.strip()
            if a and a.lower() not in seen:
                seen.add(a.lower())
                unique.append(a)

        # 写缓存
        _cache[key] = {"aliases": unique, "timestamp": time.time()}

        elapsed = time.time() - start
        print(f"[LLM] {gene_symbol} -> {len(unique)} aliases ({elapsed:.2f}s)")

        return unique

    except json.JSONDecodeError:
        return [gene_symbol]
    except Exception as e:
        raise RuntimeError(f"Failed to get gene aliases: {str(e)}")


def _parse_aliases(response_text: str, original_symbol: str) -> list[str]:
    """解析 JSON 响应"""
    text = response_text.strip()

    if "```" in text:
        lines = text.split("\n")
        json_lines = []
        in_block = False
        for line in lines:
            if "```" in line:
                in_block = not in_block
                continue
            if in_block:
                json_lines.append(line)
        if json_lines:
            text = "\n".join(json_lines)

    start = text.find("[")
    end = text.rfind("]")
    if start != -1 and end != -1:
        text = text[start : end + 1]

    try:
        aliases = json.loads(text)
        if isinstance(aliases, list):
            return [str(a) for a in aliases]
    except json.JSONDecodeError:
        pass

    lines = [
        l.strip().strip('"').strip("'").strip(",")
        for l in response_text.split("\n")
        if l.strip()
    ]
    return lines if lines else [original_symbol]
