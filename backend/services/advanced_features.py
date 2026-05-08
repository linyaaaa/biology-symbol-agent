"""
Advanced Features Service
1. Ambiguity Resolver - 歧义检测
2. Ortholog Mapping - 跨物种同源转换
3. Universal ID Bridge - 多数据库 ID 映射
4. Gene Family Suggestion - 基因家族联想
5. Deprecated Detection - 废弃基因检测
"""

import os
import json
from openai import OpenAI

ARK_API_KEY = os.getenv("ARK_API_KEY", "")
ARK_MODEL_ID = os.getenv("ARK_MODEL_ID", "glm-4-7-251222")
ARK_BASE_URL = os.getenv("ARK_BASE_URL", "https://ark.cn-beijing.volces.com/api/v3")

_client = None


def _get_client():
    global _client
    if _client is None:
        _client = OpenAI(api_key=ARK_API_KEY, base_url=ARK_BASE_URL)
    return _client


def _llm_query(system_prompt: str, user_content: str, max_tokens: int = 800) -> str:
    """通用 LLM 查询"""
    client = _get_client()
    completion = client.chat.completions.create(
        model=ARK_MODEL_ID,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        temperature=0.1,
        max_tokens=max_tokens,
    )
    return completion.choices[0].message.content.strip()


def _parse_json(text: str) -> dict | list | None:
    """从 LLM 响应中提取 JSON"""
    text = text.strip()
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
    start = text.find("{")
    if start == -1:
        start = text.find("[")
    if start != -1:
        if text[start] == "{":
            end = text.rfind("}")
        else:
            end = text.rfind("]")
        if end != -1:
            text = text[start : end + 1]
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


# ==================== 1. Ambiguity Resolver ====================

AMBIGUITY_PROMPT = """You are a gene nomenclature expert. Given a gene symbol or alias, determine if it is ambiguous (maps to multiple different approved gene symbols).

Return a JSON object:
{"ambiguous": true/false, "candidates": [{"symbol": "APPROVED_SYMBOL", "name": "Full Gene Name", "chromosome": "chrX", "description": "Brief description"}]}

If not ambiguous, candidates should have exactly one entry.
If ambiguous, list ALL possible approved gene symbols it could refer to.
Be thorough - include historical reassignments."""


def resolve_ambiguity(gene_symbol: str) -> dict:
    """检测基因符号是否存在歧义"""
    response = _llm_query(AMBIGUITY_PROMPT, gene_symbol)
    result = _parse_json(response)
    if result and isinstance(result, dict):
        return {
            "ambiguous": result.get("ambiguous", False),
            "candidates": result.get("candidates", []),
        }
    return {
        "ambiguous": False,
        "candidates": [
            {"symbol": gene_symbol, "name": "", "chromosome": "", "description": ""}
        ],
    }


# ==================== 2. Ortholog Mapping ====================

ORTHOLOG_PROMPT = """You are a comparative genomics expert. Given a gene symbol that may be from a non-human species (e.g., mouse, rat, zebrafish), map it to the human ortholog.

Return a JSON object:
{"original_species": "mouse/rat/human/etc", "human_symbol": "HUMAN_GENE_SYMBOL", "human_name": "Full Name", "confidence": "high/medium/low", "note": "brief note"}

If the symbol is already a human gene, set original_species to "human" and human_symbol to the input.
If no ortholog is found, set human_symbol to null."""


def map_ortholog(gene_symbol: str) -> dict:
    """跨物种同源映射"""
    response = _llm_query(ORTHOLOG_PROMPT, gene_symbol)
    result = _parse_json(response)
    if result and isinstance(result, dict):
        return result
    return {
        "original_species": "unknown",
        "human_symbol": None,
        "human_name": "",
        "confidence": "low",
        "note": "Could not determine ortholog",
    }


# ==================== 3. Universal ID Bridge ====================

ID_BRIDGE_PROMPT = """You are a bioinformatics expert. Given a biological identifier, determine its type and map it to the standard HGNC gene symbol.

Identifier types: Ensembl ID (ENSG...), Entrez/NCBI Gene ID (numeric), UniProt Accession (e.g., P04637), or Gene Symbol.

Return a JSON object:
{"id_type": "ensembl/entrez/uniprot/symbol/unknown", "gene_symbol": "STANDARD_SYMBOL", "gene_name": "Full Name", "mapped": true/false}

If the identifier cannot be mapped, set mapped to false and gene_symbol to null."""


def bridge_id(identifier: str) -> dict:
    """多数据库 ID 映射"""
    response = _llm_query(ID_BRIDGE_PROMPT, identifier.strip())
    result = _parse_json(response)
    if result and isinstance(result, dict):
        return result
    return {"id_type": "unknown", "gene_symbol": None, "gene_name": "", "mapped": False}


# ==================== 4. Gene Family Suggestion ====================

FAMILY_PROMPT = """You are a gene nomenclature expert. Given a gene symbol, identify its HGNC Gene Family and list other common members of that family.

Return a JSON object:
{"gene_family": "FAMILY_NAME", "queried_gene": "GENE_SYMBOL", "family_members": ["GENE1", "GENE2", "GENE3", ...], "description": "Brief description of the family"}

If the gene does not belong to a notable family, set gene_family to "None" and family_members to an empty array."""


def suggest_gene_family(gene_symbol: str) -> dict:
    """基因家族联想"""
    response = _llm_query(FAMILY_PROMPT, gene_symbol)
    result = _parse_json(response)
    if result and isinstance(result, dict):
        return result
    return {
        "gene_family": "None",
        "queried_gene": gene_symbol,
        "family_members": [],
        "description": "",
    }


# ==================== 5. Deprecated Detection ====================

DEPRECATED_PROMPT = """You are a gene nomenclature expert. Given a gene symbol, determine if it is a deprecated/withdrawn HGNC symbol, and if so, what is the current approved symbol.

Return a JSON object:
{"current_symbol": "CURRENT_APPROVED_SYMBOL", "status": "approved/deprecated/unknown", "previous_symbols": ["OLD_NAME1", "OLD_NAME2"], "note": "Brief explanation"}

If the symbol is current and approved, set status to "approved" and previous_symbols to empty array."""


def check_deprecated(gene_symbol: str) -> dict:
    """检测基因是否已废弃"""
    response = _llm_query(DEPRECATED_PROMPT, gene_symbol)
    result = _parse_json(response)
    if result and isinstance(result, dict):
        return result
    return {
        "current_symbol": gene_symbol,
        "status": "unknown",
        "previous_symbols": [],
        "note": "Could not determine status",
    }


# ==================== 6. Genomic Context ====================

GENOMIC_CONTEXT_PROMPT = """You are a genomics expert. Given a human gene symbol, provide its genomic location and neighboring genes.

Return a JSON object:
{
  "gene_symbol": "GENE",
  "chromosome": "chrN",
  "start": 1234567,
  "end": 2345678,
  "strand": "+" or "-",
  "cytoband": "e.g. 17p13.1",
  "neighbors": [
    {"symbol": "GENE1", "name": "Full Name", "distance_kb": 50, "direction": "upstream/downstream"},
    {"symbol": "GENE2", "name": "Full Name", "distance_kb": 120, "direction": "downstream"}
  ]
}

Include 4-6 nearest neighbors (2-3 upstream, 2-3 downstream). Use approximate positions if exact are unknown.
Distance should be in kilobases (kb) from the gene boundary."""


def get_genomic_context(gene_symbol: str) -> dict:
    """获取基因的基因组位置和邻居基因"""
    response = _llm_query(GENOMIC_CONTEXT_PROMPT, gene_symbol, max_tokens=600)
    result = _parse_json(response)
    if result and isinstance(result, dict) and result.get("chromosome"):
        return result
    return {
        "gene_symbol": gene_symbol,
        "chromosome": "",
        "start": 0,
        "end": 0,
        "strand": "",
        "cytoband": "",
        "neighbors": [],
    }


# ==================== 7. Functional Expansion ====================

FUNCTIONAL_EXPANSION_PROMPT = """You are a systems biology expert. Given a human gene symbol, identify its top 5 functionally associated genes based on protein-protein interactions, pathway co-membership (KEGG, Reactome, GO), or regulatory relationships.

Return a JSON object:
{
  "query_gene": "GENE",
  "associations": [
    {"gene": "ASSOCIATED_GENE", "relationship": "e.g. direct PPI, pathway co-member, upstream regulator, downstream target", "pathway": "e.g. JAK-STAT signaling, Cell cycle", "confidence": "high/medium/low"}
  ]
}

Include exactly 5 associations ranked by biological relevance. Be specific about the relationship type."""


def get_functional_expansion(gene_symbol: str) -> dict:
    """获取功能关联基因 Top 5"""
    response = _llm_query(FUNCTIONAL_EXPANSION_PROMPT, gene_symbol, max_tokens=600)
    result = _parse_json(response)
    if result and isinstance(result, dict) and result.get("associations"):
        return result
    return {"query_gene": gene_symbol, "associations": []}
