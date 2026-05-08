"""
批量别名生成服务 - 从数据集基因列表批量调用 LLM 生成 aliases 及其他 ID
"""

import os
import json
import threading
import time
from services.llm_service import get_gene_aliases
from services.gene_search_service import _dataset_genes, load_all_datasets

# 生成状态（全局，支持进度查询）
_generation_state = {
    "status": "idle",  # idle | running | done | error
    "total": 0,
    "completed": 0,
    "results": {},  # { gene_name: { aliases, symbol, ensembl_id, uniprot, entrez_id, gene_name } }
    "error": None,
    "start_time": None,
    "end_time": None,
}

# 默认 output types
DEFAULT_OUTPUT_TYPES = ["aliases", "symbol"]

BATCH_SYSTEM_PROMPT = """You are a biology expert specializing in gene nomenclature and bioinformatics.
I will give you a batch of gene symbols. For EACH gene symbol, return structured information.

Return ONLY a JSON object where keys are gene symbols and values are objects with these fields:
- "symbol": the official/approved HGNC gene symbol
- "gene_name": the full gene name (e.g. "tumor protein p53")
- "aliases": array of all known alias strings (official symbol, abbreviations, former names, protein names)
- "ensembl_id": Ensembl Gene ID (e.g. "ENSG00000141510") or null if unknown
- "uniprot": UniProt accession (e.g. "P04637") or null if unknown
- "entrez_id": NCBI Gene ID (integer as string, e.g. "7157") or null if unknown

Rules:
- If a gene symbol is not recognized, set all fields to null and aliases to empty array.
- Do NOT include any text outside the JSON object.

Example:
{"TP53": {"symbol": "TP53", "gene_name": "tumor protein p53", "aliases": ["TP53", "P53", "tumor protein p53"], "ensembl_id": "ENSG00000141510", "uniprot": "P04637", "entrez_id": "7157"}}"""

BATCH_SIZE = 20


def get_all_unique_genes() -> list[str]:
    """获取所有数据集的唯一基因名列表（按字母排序）"""
    if not _dataset_genes:
        load_all_datasets()
    all_genes = set()
    for gene_set in _dataset_genes.values():
        all_genes.update(gene_set)
    return sorted(all_genes)


def _parse_batch_response(response_text: str) -> dict:
    """解析批量响应的 JSON 对象"""
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
    start = text.find("{")
    end = text.rfind("}")
    if start != -1 and end != -1:
        text = text[start : end + 1]
    try:
        result = json.loads(text)
        if isinstance(result, dict):
            return result
    except json.JSONDecodeError:
        pass
    return {}


def _normalize_gene_data(gene_symbol: str, data) -> dict:
    """将 LLM 返回的数据标准化为统一格式"""
    if isinstance(data, list):
        # 旧格式：纯别名列表
        aliases = data
        return {
            "symbol": gene_symbol,
            "gene_name": "",
            "aliases": aliases,
            "ensembl_id": "",
            "uniprot": "",
            "entrez_id": "",
        }
    elif isinstance(data, dict):
        aliases = data.get("aliases", [])
        if isinstance(aliases, list):
            seen = set()
            unique = []
            for a in aliases:
                a_clean = a.strip()
                if a_clean and a_clean.lower() not in seen:
                    seen.add(a_clean.lower())
                    unique.append(a_clean)
            aliases = unique
        return {
            "symbol": data.get("symbol") or gene_symbol,
            "gene_name": data.get("gene_name") or "",
            "aliases": aliases,
            "ensembl_id": data.get("ensembl_id") or "",
            "uniprot": data.get("uniprot") or "",
            "entrez_id": data.get("entrez_id") or "",
        }
    else:
        return {
            "symbol": gene_symbol,
            "gene_name": "",
            "aliases": [gene_symbol],
            "ensembl_id": "",
            "uniprot": "",
            "entrez_id": "",
        }


def _process_batch(genes_batch: list[str]) -> dict:
    """处理一批基因，调用 LLM 获取结构化信息"""
    from services.llm_service import client

    gene_list_str = json.dumps(genes_batch)

    try:
        completion = client.chat.completions.create(
            model=os.getenv("ARK_MODEL_ID", "glm-4-7-251222"),
            messages=[
                {"role": "system", "content": BATCH_SYSTEM_PROMPT},
                {"role": "user", "content": gene_list_str},
            ],
            temperature=0.1,
            max_tokens=6000,
        )
        response_text = completion.choices[0].message.content.strip()
        return _parse_batch_response(response_text)
    except Exception as e:
        print(f"[ERROR] Batch failed: {str(e)}")
        results = {}
        for gene in genes_batch:
            try:
                aliases = get_gene_aliases(gene)
                results[gene] = {"aliases": aliases, "symbol": gene}
            except:
                results[gene] = {"aliases": [gene], "symbol": gene}
        return results


def start_generation(source: str = "database", gene_list: list[str] = None, limit: int = 50):
    global _generation_state
    if _generation_state["status"] == "running":
        return {"error": "Generation already in progress"}

    if source == "uploaded":
        if not gene_list:
            return {"error": "No uploaded gene list provided"}
        all_genes = gene_list
    else:
        all_genes = get_all_unique_genes()
        all_genes = all_genes[:limit]

    total = len(all_genes)
    _generation_state = {
        "status": "running",
        "total": total,
        "completed": 0,
        "results": {},
        "error": None,
        "start_time": time.time(),
        "end_time": None,
        "avg_batch_time": 0.0,
        "estimated_remaining": 0,
    }

    thread = threading.Thread(target=_run_generation, args=(all_genes,), daemon=True)
    thread.start()
    return {"total": total, "message": f"Started generating aliases for {total} genes"}


def _run_generation(all_genes: list[str]):
    global _generation_state
    try:
        batches = []
        for i in range(0, len(all_genes), BATCH_SIZE):
            batches.append(all_genes[i : i + BATCH_SIZE])

        total_batches = len(batches)
        batch_times = []

        for batch_idx, batch in enumerate(batches):
            if _generation_state["status"] != "running":
                break

            batch_start = time.time()
            try:
                batch_results = _process_batch(batch)
                for gene, data in batch_results.items():
                    _generation_state["results"][gene] = _normalize_gene_data(gene, data)
            except Exception as e:
                for gene in batch:
                    try:
                        aliases = get_gene_aliases(gene)
                        _generation_state["results"][gene] = _normalize_gene_data(gene, {"aliases": aliases})
                    except:
                        _generation_state["results"][gene] = _normalize_gene_data(gene, None)

            batch_end = time.time()
            batch_times.append(batch_end - batch_start)

            if len(batch_times) > 0:
                avg_time = sum(batch_times) / len(batch_times)
                remaining_batches = total_batches - batch_idx - 1
                _generation_state["avg_batch_time"] = round(avg_time, 1)
                _generation_state["estimated_remaining"] = int(avg_time * remaining_batches)

            _generation_state["completed"] = min((batch_idx + 1) * BATCH_SIZE, len(all_genes))
            time.sleep(0.3)

        _generation_state["status"] = "done"
        _generation_state["end_time"] = time.time()
    except Exception as e:
        _generation_state["status"] = "error"
        _generation_state["error"] = str(e)
        _generation_state["end_time"] = time.time()


def get_generation_status() -> dict:
    state = _generation_state.copy()
    state["results_count"] = len(state["results"])
    state.pop("results", None)
    return state


# ==================== CSV 生成（支持动态 output_types） ====================

# output_type → CSV 列名 映射
OUTPUT_TYPE_COLUMNS = {
    "symbol": "Symbol (gene name)",
    "aliases": "aliases",
    "ensembl_id": "ensembl_id",
    "uniprot": "uniprot",
    "entrez_id": "entrez_id",
    "status": "status",
    "mgi_link": "mgi_link",
}


def get_aliases_csv_content(output_types: list[str] = None) -> str:
    """根据 output_types 动态生成 CSV"""
    if _generation_state["status"] != "done":
        raise ValueError("Generation not completed yet")

    if not output_types:
        output_types = DEFAULT_OUTPUT_TYPES

    # 构建 CSV 列：symbol 和 aliases 始终在前两列
    columns = []
    # 确保第一列是 Symbol (gene name)
    if "Symbol (gene name)" not in columns:
        columns.append("Symbol (gene name)")
    # 确保第二列是 aliases
    if "aliases" not in columns:
        columns.append("aliases")
    # 其他用户选中的列
    for ot in output_types:
        col = OUTPUT_TYPE_COLUMNS.get(ot)
        if col and col not in columns:
            columns.append(col)

    # 始终包含 status 和 mgi_link
    if "status" not in columns:
        columns.append("status")
    if "mgi_link" not in columns:
        columns.append("mgi_link")

    # CSV header
    lines = [",".join(columns)]

    for gene_name in sorted(_generation_state["results"].keys()):
        data = _generation_state["results"][gene_name]
        row = {}
        for ot in output_types:
            if ot == "symbol":
                gene_name_str = data.get("gene_name", "")
                symbol_val = data.get("symbol", gene_name)
                if gene_name_str:
                    row["Symbol (gene name)"] = f"{symbol_val} ({gene_name_str})"
                else:
                    row["Symbol (gene name)"] = symbol_val
            elif ot == "aliases":
                aliases = data.get("aliases", [])
                if isinstance(aliases, list):
                    row["aliases"] = ";".join(aliases)
                else:
                    row["aliases"] = str(aliases)
            elif ot == "ensembl_id":
                row["ensembl_id"] = data.get("ensembl_id", "")
            elif ot == "uniprot":
                row["uniprot"] = data.get("uniprot", "")
            elif ot == "entrez_id":
                row["entrez_id"] = data.get("entrez_id", "")

        # status 和 mgi_link
        alias_list = data.get("aliases", [])
        if isinstance(alias_list, str):
            alias_list = [a.strip() for a in alias_list.split(";") if a.strip()]
        row["status"] = _determine_status(gene_name, alias_list, _dataset_genes)
        row["mgi_link"] = _build_mgi_link(gene_name)

        # 按列顺序构建行
        csv_row = []
        for col in columns:
            val = row.get(col, "")
            csv_row.append(f'"{val}"')
        lines.append(",".join(csv_row))

    return "\n".join(lines)


def _build_mgi_link(gene_name: str) -> str:
    return f"https://www.informatics.jax.org/search?q={gene_name}"


def _determine_status(gene_name: str, aliases: list[str], dataset_genes: dict) -> str:
    gene_lower = gene_name.lower()
    found_in_datasets = []
    for ds_name, gene_set in dataset_genes.items():
        if any(g.lower() == gene_lower for g in gene_set):
            found_in_datasets.append(ds_name)
    if found_in_datasets:
        if len(aliases) > 1:
            return "Alias Match"
        return "Exact Match"
    for alias in aliases:
        alias_lower = alias.lower()
        if alias_lower == gene_lower:
            continue
        for ds_name, gene_set in dataset_genes.items():
            if any(g.lower() == alias_lower for g in gene_set):
                return f"Alias Match (via {alias})"
    return "Not Found in Datasets"
