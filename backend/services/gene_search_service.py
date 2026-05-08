"""
基因搜索服务 - 从 single-cell 数据集的 features.tsv.gz 中加载基因列表，精确匹配
"""

import os
import gzip
import time

# 数据集目录（相对于 backend/）
DATA_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data"
)

# 三个数据集的 features.tsv.gz 路径（原始，含敏感数据）
DATASET_PATHS = {
    "Dataset0713": os.path.join(
        DATA_DIR, "Dataset0713_Metadata", "normalized_matrix", "features.tsv.gz"
    ),
    "Dataset1348": os.path.join(
        DATA_DIR, "Dataset1348_Metadata", "normalized_matrix", "features.tsv.gz"
    ),
    "Dataset3005": os.path.join(
        DATA_DIR, "Dataset3005_Metadata", "normalized_matrix", "features.tsv.gz"
    ),
}

# 脱敏基因列表路径（仅基因名，可安全提交到 Git）
DATASET_PUBLIC_PATHS = {
    "Dataset0713": os.path.join(
        DATA_DIR, "public", "Dataset0713_Metadata", "genes.txt"
    ),
    "Dataset1348": os.path.join(
        DATA_DIR, "public", "Dataset1348_Metadata", "genes.txt"
    ),
    "Dataset3005": os.path.join(
        DATA_DIR, "public", "Dataset3005_Metadata", "genes.txt"
    ),
}

# 每个数据集的基因集合（启动时加载）
# 格式: { dataset_name: set(gene_names) }
_dataset_genes: dict[str, set[str]] = {}


def load_all_datasets():
    """
    从三个数据集加载基因名列表。
    优先使用脱敏的 genes.txt（可安全提交到 Git），
    回退到 features.tsv.gz（含敏感数据，仅在本地开发时可用）。

    Returns:
        dict: { dataset_name: set(gene_names) }
    """
    global _dataset_genes
    _dataset_genes = {}

    for dataset_name in DATASET_PATHS:
        genes = set()
        public_path = DATASET_PUBLIC_PATHS.get(dataset_name)
        original_path = DATASET_PATHS[dataset_name]

        # Try public (sanitized) file first
        if public_path and os.path.exists(public_path):
            with open(public_path, "r", encoding="utf-8") as f:
                for line in f:
                    gene = line.strip()
                    if gene:
                        genes.add(gene)
            print(
                f"[INFO] {dataset_name}: loaded {len(genes)} genes from genes.txt (public)"
            )
        # Fallback to original features.tsv.gz
        elif os.path.exists(original_path):
            with gzip.open(original_path, "rt", encoding="utf-8") as f:
                for line in f:
                    gene = line.strip()
                    if gene:
                        genes.add(gene)
            print(
                f"[INFO] {dataset_name}: loaded {len(genes)} genes from features.tsv.gz (original)"
            )
        else:
            print(f"[WARNING] {dataset_name}: no gene list found - tried {public_path} and {original_path}")

        _dataset_genes[dataset_name] = genes

    return _dataset_genes


def get_all_unique_gene_count() -> int:
    """获取所有数据集的唯一基因总数"""
    if not _dataset_genes:
        load_all_datasets()
    all_genes = set()
    for gene_set in _dataset_genes.values():
        all_genes.update(gene_set)
    return len(all_genes)


def search_genes_exact(search_terms: list[str]) -> list[dict]:
    """
    在所有数据集中精确匹配基因名（不模糊匹配）

    对于每个 search_term，在每个数据集中查找是否存在完全一致的基因名。
    RB1 和 ERBB2 不会互相匹配。

    Args:
        search_terms: 搜索词列表（原始 symbol + aliases），全部小写化后精确匹配

    Returns:
        匹配结果列表，格式:
        [
            {
                "dataset": "Dataset0713",
                "gene_name": "TP53",       # 数据集中的原始基因名（保留原始大小写）
                "matched_term": "P53",     # 命中的搜索词（用户输入或 alias）
                "match_source": "alias"    # "input" | "alias"
            },
            ...
        ]
    """
    if not _dataset_genes:
        load_all_datasets()

    results = []

    start_time = time.time()
    for dataset_name, gene_set in _dataset_genes.items():
        # 构建小写 -> 原始基因名的映射，用于精确匹配时保留原始大小写
        gene_lower_map: dict[str, str] = {}
        for gene in gene_set:
            gene_lower_map[gene.lower()] = gene

        for i, term in enumerate(search_terms):
            term_lower = term.strip().lower()
            if not term_lower:
                continue

            # 精确匹配（不区分大小写）
            if term_lower in gene_lower_map:
                original_gene_name = gene_lower_map[term_lower]
                match_source = "input" if i == 0 else "alias"
                results.append(
                    {
                        "dataset": dataset_name,
                        "gene_name": original_gene_name,
                        "matched_term": term.strip(),
                        "match_source": match_source,
                    }
                )

    end_time = time.time()
    print(
        f"[INFO] search_genes_exact: {len(search_terms)} terms processed in {end_time - start_time:.4f}s"
    )

    return results


# 应用启动时自动加载数据
load_all_datasets()
