"""
Gene Search & Advanced Features API Routes (Flask Blueprint)
"""

import os
import time
import tempfile
from flask import Blueprint, request, jsonify, Response
from services.llm_service import get_gene_aliases
from services.gene_search_service import search_genes_exact, get_all_unique_gene_count
from services.alias_generator import start_generation, get_generation_status, get_aliases_csv_content
from services.file_parser import parse_gene_file
from services.advanced_features import (
    resolve_ambiguity, map_ortholog, bridge_id,
    suggest_gene_family, check_deprecated,
    get_genomic_context, get_functional_expansion,
)
from services.rate_limiter import rate_limit_required, increment_usage, get_quota_status

bp = Blueprint("search", __name__)

UPLOAD_DIR = os.path.join(tempfile.gettempdir(), "bsca_uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# 多文件存储：{ file_id: { filename, genes, clean_report, total_lines, gene_count, issues_count, uploaded_at } }
_upload_history: dict[str, dict] = {}
_file_counter = 0


# ==================== Gene Search ====================

@bp.route("/search", methods=["POST"])
@rate_limit_required
def search_gene_symbol():
    data = request.get_json(silent=True) or {}
    query = (data.get("gene_symbol") or "").strip()
    if not query:
        return jsonify({"detail": "Gene symbol cannot be empty"}), 400

    cross_species = data.get("cross_species", False)

    try:
        # Cross-species: map to human first
        ortholog_info = None
        if cross_species:
            from services.advanced_features import map_ortholog
            ortholog_info = map_ortholog(query)
            if ortholog_info.get("human_symbol") and ortholog_info["human_symbol"].lower() != query.lower():
                query = ortholog_info["human_symbol"]

        aliases = get_gene_aliases(query)
        increment_usage()  # Count LLM call
        search_terms = [query] + aliases
        raw_matches = search_genes_exact(search_terms)

        dataset_results = {}
        for match in raw_matches:
            ds = match["dataset"]
            if ds not in dataset_results:
                dataset_results[ds] = {"dataset": ds, "gene_name": match["gene_name"], "matched_terms": []}
            dataset_results[ds]["matched_terms"].append(match["matched_term"])

        for ds_data in dataset_results.values():
            seen = set()
            unique = []
            for t in ds_data["matched_terms"]:
                if t.lower() not in seen:
                    seen.add(t.lower())
                    unique.append(t)
            ds_data["matched_terms"] = unique

        results = sorted(dataset_results.values(), key=lambda x: x["dataset"])

        return jsonify({
            "query": query,
            "aliases": aliases,
            "matches": results,
            "total_matches": len(results),
            "status": "success",
            "message": f"Found {len(results)} dataset(s) with gene '{query}'",
            "ortholog_info": ortholog_info,
        })

    except Exception as e:
        return jsonify({"detail": str(e)}), 500


@bp.route("/advanced/genomic-context", methods=["POST"])
def genomic_context():
    """Feature 7: Interactive Genomic Context"""
    data = request.get_json(silent=True) or {}
    symbol = (data.get("gene_symbol") or "").strip()
    if not symbol:
        return jsonify({"detail": "Gene symbol required"}), 400
    try:
        result = get_genomic_context(symbol)
        return jsonify(result)
    except Exception as e:
        return jsonify({"detail": str(e)}), 500


@bp.route("/advanced/functional-expansion", methods=["POST"])
def functional_expansion():
    """Feature 8: Functional Expansion / Guilt-by-Association"""
    data = request.get_json(silent=True) or {}
    symbol = (data.get("gene_symbol") or "").strip()
    if not symbol:
        return jsonify({"detail": "Gene symbol required"}), 400
    try:
        result = get_functional_expansion(symbol)
        return jsonify(result)
    except Exception as e:
        return jsonify({"detail": str(e)}), 500


@bp.route("/search/<gene_symbol>", methods=["GET"])
def search_gene_symbol_get(gene_symbol):
    query = gene_symbol.strip()
    if not query:
        return jsonify({"detail": "Gene symbol cannot be empty"}), 400
    try:
        aliases = get_gene_aliases(query)
        search_terms = [query] + aliases
        raw_matches = search_genes_exact(search_terms)
        dataset_results = {}
        for match in raw_matches:
            ds = match["dataset"]
            if ds not in dataset_results:
                dataset_results[ds] = {"dataset": ds, "gene_name": match["gene_name"], "matched_terms": []}
            dataset_results[ds]["matched_terms"].append(match["matched_term"])
        for ds_data in dataset_results.values():
            seen = set(); unique = []
            for t in ds_data["matched_terms"]:
                if t.lower() not in seen: seen.add(t.lower()); unique.append(t)
            ds_data["matched_terms"] = unique
        results = sorted(dataset_results.values(), key=lambda x: x["dataset"])
        return jsonify({"query": query, "aliases": aliases, "matches": results, "total_matches": len(results), "status": "success", "message": f"Found {len(results)} dataset(s) with gene '{query}'"})
    except Exception as e:
        return jsonify({"detail": str(e)}), 500


# ==================== File Upload ====================

ALLOWED_EXTENSIONS = {".txt", ".csv", ".xlsx", ".docx"}

@bp.route("/upload-genes", methods=["POST"])
def upload_genes():
    global _file_counter
    if "file" not in request.files:
        return jsonify({"detail": "No file provided"}), 400
    file = request.files["file"]
    if not file.filename:
        return jsonify({"detail": "No file selected"}), 400
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        return jsonify({"detail": f"Unsupported format: {ext}"})

    tmp_path = os.path.join(UPLOAD_DIR, file.filename)
    file.save(tmp_path)
    try:
        result = parse_gene_file(tmp_path)
        _file_counter += 1
        file_id = f"file_{_file_counter}"
        entry = {
            "file_id": file_id,
            "filename": result["filename"],
            "total_lines": result["total_lines"],
            "gene_count": result["gene_count"],
            "genes": result["genes"],
            "clean_report": result.get("clean_report", []),
            "issues_count": result.get("issues_count", 0),
            "uploaded_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        }
        _upload_history[file_id] = entry
        return jsonify({
            "status": "success",
            "file_id": file_id,
            **entry,
        })
    except Exception as e:
        return jsonify({"detail": f"Failed to parse file: {str(e)}"}), 500
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


@bp.route("/upload-history", methods=["GET"])
def upload_history():
    """获取上传文件历史列表"""
    history = []
    for fid, entry in _upload_history.items():
        history.append({
            "file_id": fid,
            "filename": entry["filename"],
            "gene_count": entry["gene_count"],
            "total_lines": entry["total_lines"],
            "issues_count": entry["issues_count"],
            "uploaded_at": entry["uploaded_at"],
        })
    # 按上传时间倒序
    history.sort(key=lambda x: x["uploaded_at"], reverse=True)
    return jsonify({"files": history, "total": len(history)})


# ==================== Aliases Generation ====================

@bp.route("/generate-aliases", methods=["POST"])
def generate_aliases():
    data = request.get_json(silent=True) or {}
    source = data.get("source", "database")
    limit = data.get("limit", 50)
    if source == "uploaded":
        # 支持选择多个文件
        file_ids = data.get("file_ids", [])
        gene_list = []
        if file_ids:
            for fid in file_ids:
                if fid in _upload_history:
                    gene_list.extend(_upload_history[fid]["genes"])
            # 去重
            seen = set()
            unique = []
            for g in gene_list:
                if g.lower() not in seen:
                    seen.add(g.lower())
                    unique.append(g)
            gene_list = unique
        if not gene_list:
            return jsonify({"error": "No genes found in selected files"}), 400
        result = start_generation(source="uploaded", gene_list=gene_list)
    else:
        result = start_generation(source="database", limit=limit)
    if "error" in result:
        return jsonify(result), 400
    return jsonify(result)


@bp.route("/database-gene-count", methods=["GET"])
def database_gene_count():
    """获取数据库中唯一基因总数"""
    return jsonify({"total_genes": get_all_unique_gene_count()})


@bp.route("/generate-aliases/status", methods=["GET"])
def generation_status():
    return jsonify(get_generation_status())


@bp.route("/download-aliases", methods=["GET"])
def download_aliases():
    status = get_generation_status()
    if status["status"] != "done":
        return jsonify({"detail": "Generation not completed yet"}), 400
    # 从 query params 获取 output_types
    output_types = request.args.getlist("output_types")
    if not output_types:
        output_types = None
    csv_content = get_aliases_csv_content(output_types)
    from datetime import datetime
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    return Response(csv_content, mimetype="text/csv", headers={"Content-Disposition": f"attachment; filename=gene_aliases_{timestamp}.csv"})


# ==================== Coverage Report ====================

@bp.route("/coverage-report", methods=["POST"])
def coverage_report():
    """Data Coverage Analytics: 统计上传基因在数据集中的覆盖率"""
    data = request.get_json(silent=True) or {}
    genes = data.get("genes", [])
    aliases_map = data.get("aliases_map", {})  # {gene: "alias1;alias2"}

    if not genes:
        return jsonify({"detail": "No genes provided"}), 400

    from services.gene_search_service import _dataset_genes

    total = len(genes)
    direct_matches = 0
    alias_matches = 0
    unmatched = 0
    details = []

    for gene in genes:
        gene_lower = gene.lower()
        found_direct = False
        found_alias = False
        matched_via = ""

        # 检查直接匹配
        for ds_name, gene_set in _dataset_genes.items():
            if any(g.lower() == gene_lower for g in gene_set):
                found_direct = True
                break

        if found_direct:
            direct_matches += 1
            details.append({"gene": gene, "status": "Direct Match", "mgi_link": f"https://www.informatics.jax.org/search?q={gene}"})
        else:
            # 检查别名匹配
            gene_aliases = aliases_map.get(gene, "")
            alias_list = [a.strip() for a in gene_aliases.split(";") if a.strip()] if gene_aliases else []
            for alias in alias_list:
                alias_lower = alias.lower()
                if alias_lower == gene_lower:
                    continue
                for ds_name, gene_set in _dataset_genes.items():
                    if any(g.lower() == alias_lower for g in gene_set):
                        found_alias = True
                        matched_via = alias
                        break
                if found_alias:
                    break

            if found_alias:
                alias_matches += 1
                details.append({"gene": gene, "status": "Alias Match", "matched_via": matched_via, "mgi_link": f"https://www.informatics.jax.org/search?q={gene}"})
            else:
                unmatched += 1
                details.append({"gene": gene, "status": "Unmatched", "mgi_link": f"https://www.informatics.jax.org/search?q={gene}"})

    return jsonify({
        "total": total,
        "direct_matches": direct_matches,
        "alias_matches": alias_matches,
        "unmatched": unmatched,
        "coverage_percent": round(((direct_matches + alias_matches) / total * 100) if total > 0 else 0, 1),
        "details": details,
    })


# ==================== Advanced Features ====================

@bp.route("/advanced/ambiguity", methods=["POST"])
def check_ambiguity():
    """Feature 1: Ambiguity Resolver"""
    data = request.get_json(silent=True) or {}
    symbol = (data.get("gene_symbol") or "").strip()
    if not symbol:
        return jsonify({"detail": "Gene symbol required"}), 400
    try:
        result = resolve_ambiguity(symbol)
        return jsonify(result)
    except Exception as e:
        return jsonify({"detail": str(e)}), 500


@bp.route("/advanced/ortholog", methods=["POST"])
def check_ortholog():
    """Feature 2: Cross-Species Ortholog Mapping"""
    data = request.get_json(silent=True) or {}
    symbol = (data.get("gene_symbol") or "").strip()
    if not symbol:
        return jsonify({"detail": "Gene symbol required"}), 400
    try:
        result = map_ortholog(symbol)
        return jsonify(result)
    except Exception as e:
        return jsonify({"detail": str(e)}), 500


@bp.route("/advanced/bridge-id", methods=["POST"])
def bridge_gene_id():
    """Feature 3: Universal ID Bridge"""
    data = request.get_json(silent=True) or {}
    identifier = (data.get("identifier") or "").strip()
    if not identifier:
        return jsonify({"detail": "Identifier required"}), 400
    try:
        result = bridge_id(identifier)
        return jsonify(result)
    except Exception as e:
        return jsonify({"detail": str(e)}), 500


@bp.route("/advanced/gene-family", methods=["POST"])
def get_gene_family():
    """Feature 5: Gene Family Suggestion"""
    data = request.get_json(silent=True) or {}
    symbol = (data.get("gene_symbol") or "").strip()
    if not symbol:
        return jsonify({"detail": "Gene symbol required"}), 400
    try:
        result = suggest_gene_family(symbol)
        return jsonify(result)
    except Exception as e:
        return jsonify({"detail": str(e)}), 500


@bp.route("/advanced/deprecated", methods=["POST"])
def check_gene_deprecated():
    """Feature 4: Deprecated Gene Detection"""
    data = request.get_json(silent=True) or {}
    symbol = (data.get("gene_symbol") or "").strip()
    if not symbol:
        return jsonify({"detail": "Gene symbol required"}), 400
    try:
        result = check_deprecated(symbol)
        return jsonify(result)
    except Exception as e:
        return jsonify({"detail": str(e)}), 500


# ==================== Quota Status ====================

@bp.route("/quota", methods=["GET"])
def quota_status():
    """Get current quota status (no rate limit on this endpoint)"""
    return jsonify(get_quota_status())
