import { useState, useCallback, useRef, useEffect } from 'react'
import './App.css'

// API base URL: use environment variable in production, or '/api' in development (proxied)
const API_BASE = import.meta.env.VITE_API_BASE || '/api'

function App() {
  const [geneSymbol, setGeneSymbol] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [history, setHistory] = useState([])

  // ===== Quota Status =====
  const [quota, setQuota] = useState(null) // { daily_quota, daily_used, daily_remaining, rate_limit_per_hour }

  const [genStatus, setGenStatus] = useState('idle')
  const [genProgress, setGenProgress] = useState({ total: 0, completed: 0, results_count: 0 })
  const pollRef = useRef(null)

  const [uploadResult, setUploadResult] = useState(null)
  const [showGeneList, setShowGeneList] = useState(false)
  const [showSourceModal, setShowSourceModal] = useState(false)
  const [duplicateModal, setDuplicateModal] = useState(null) // { filename, existingFileId }

  // ===== Upload History & Multi-File Selection =====
  const [uploadHistory, setUploadHistory] = useState([])
  const [uploadedFilesMap, setUploadedFilesMap] = useState({}) // { file_id: fullUploadResult }
  const [selectedFileIds, setSelectedFileIds] = useState(new Set())
  const [showFileSelection, setShowFileSelection] = useState(false)

  // ===== Feature 1: Ambiguity Resolver =====
  const [ambiguityData, setAmbiguityData] = useState(null)

  // ===== Feature 2: Cross-Species Toggle =====
  const [crossSpecies, setCrossSpecies] = useState(false)
  const [orthologInfo, setOrthologInfo] = useState(null)

  // ===== Gene Count Selector for Database Generation =====
  const [dbGeneCount, setDbGeneCount] = useState(0)
  const [dbGeneLimit, setDbGeneLimit] = useState(50)

  // ===== Feature 5: Gene Family Suggestion =====
  const [familyData, setFamilyData] = useState(null)
  const [showFamilyMembers, setShowFamilyMembers] = useState(false)

  // ===== Feature 6: Data Cleaning Preview =====
  const [showCleaningPreview, setShowCleaningPreview] = useState(false)

  // ===== Feature 5: Data Coverage Analytics =====
  const [coverageReport, setCoverageReport] = useState(null)
  const [coverageLoading, setCoverageLoading] = useState(false)
  const [showCoverageDetails, setShowCoverageDetails] = useState(false)

  // ===== Output Type Selector for CSV Download =====
  const [outputTypes, setOutputTypes] = useState(['aliases', 'symbol'])

  // ===== Feature: Genomic Context (multi-gene) =====
  const [genomicContextMap, setGenomicContextMap] = useState({}) // { gene: data }
  const [genomicContextLoading, setGenomicContextLoading] = useState(false)

  // ===== Feature: Functional Expansion (multi-gene) =====
  const [functionalExpansionMap, setFunctionalExpansionMap] = useState({}) // { gene: data }
  const [functionalExpansionLoading, setFunctionalExpansionLoading] = useState(false)

  // ===== Feature: Comparison List =====
  const [comparisonList, setComparisonList] = useState([])

  // ===== Multi-gene search results map =====
  const [resultMap, setResultMap] = useState({}) // { geneName: resultData }
  const [multiGeneLoading, setMultiGeneLoading] = useState(false) // tracks individual gene completions

  // ===== Accordion state for multi-gene panels =====
  const [expandedGenes, setExpandedGenes] = useState({})
  const toggleGeneExpand = useCallback((gene) => {
    setExpandedGenes(prev => ({ ...prev, [gene]: !prev[gene] }))
  }, [])

  // ===== Helpers: parse gene input =====
  const MAX_GENES = 5
  const parseGeneInput = (input) => {
    return [...new Set(input.split(/[,;\s]+/).map(g => g.trim()).filter(Boolean))]
  }

  // ===== Upload History: fetch on mount =====
  const fetchUploadHistory = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/upload-history`)
      if (!res.ok) return
      const data = await res.json()
      if (Array.isArray(data.files)) {
        setUploadHistory(data.files)
      }
    } catch {
      // ignore
    }
  }, [])

  // Fetch total gene count on mount
  useEffect(() => {
    const fetchDbGeneCount = async () => {
      try {
        const res = await fetch(`${API_BASE}/database-gene-count`)
        const data = await res.json()
        if (typeof data.count === 'number') {
          setDbGeneCount(data.count)
        }
      } catch {
        // ignore — will default to 0
      }
    }
    fetchDbGeneCount()
    fetchUploadHistory()

    // Fetch quota status
    const fetchQuota = async () => {
      try {
        const res = await fetch(`${API_BASE}/quota`)
        const data = await res.json()
        setQuota(data)
      } catch {
        // ignore
      }
    }
    fetchQuota()
  }, [fetchUploadHistory])

  // ===== Upload History: load file from history =====
  const loadFileFromHistory = (fileId) => {
    const cached = uploadedFilesMap[fileId]
    if (cached) {
      setUploadResult(cached)
      setShowGeneList(false)
      setShowCleaningPreview(false)
      setCoverageReport(null)
      setShowCoverageDetails(false)
    } else {
      setError('Please re-upload this file to view its data.')
    }
  }

  // ===== Multi-File Selection: toggle file =====
  const toggleFileSelection = (fileId) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev)
      if (next.has(fileId)) {
        next.delete(fileId)
      } else {
        next.add(fileId)
      }
      return next
    })
  }

  const startPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/generate-aliases/status`)
        const data = await res.json()
        setGenStatus(data.status)
        setGenProgress({
          total: data.total,
          completed: data.completed,
          results_count: data.results_count,
          estimated_remaining: data.estimated_remaining || 0,
          avg_batch_time: data.avg_batch_time || 0,
        })
        if (['done', 'error', 'idle'].includes(data.status)) {
          clearInterval(pollRef.current)
          pollRef.current = null
        }
      } catch { /* ignore */ }
    }, 2000)
  }, [])

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const handleGenerateClick = () => {
    if (uploadResult && uploadResult.gene_count > 0) {
      setShowSourceModal(true)
      setShowFileSelection(false)
      setSelectedFileIds(new Set())
    } else {
      doStartGeneration('database', dbGeneLimit)
    }
  }

  const doStartGeneration = async (source, limit, fileIds) => {
    setShowSourceModal(false)
    setShowFileSelection(false)
    setError(null)
    try {
      const body = { source }
      if (source === 'database' && limit != null) {
        body.limit = limit
      }
      if (source === 'uploaded' && fileIds && fileIds.length > 0) {
        body.file_ids = fileIds
      }
      const res = await fetch(`${API_BASE}/generate-aliases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.error) { setError(data.error); return }
      setGenStatus('running')
      setGenProgress({ total: data.total, completed: 0, results_count: 0 })
      startPolling()
    } catch (err) { setError(err.message) }
  }

  const downloadCSV = () => {
    const params = outputTypes.map((t) => `output_types=${encodeURIComponent(t)}`).join('&')
    window.location.href = `${API_BASE}/download-aliases?${params}`
  }

  const handleFileUpload = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    setError(null)

    // Check if this filename already exists in history
    const existing = uploadHistory.find((item) => item.filename === file.name)
    if (existing) {
      setDuplicateModal({ filename: file.name, existingFileId: existing.file_id })
      e.target.value = ''
      return
    }

    setUploadResult(null)
    setShowGeneList(false)
    setShowCleaningPreview(false)
    setCoverageReport(null)
    setShowCoverageDetails(false)
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await fetch(`${API_BASE}/upload-genes`, { method: 'POST', body: formData })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Upload failed')
      setUploadResult(data)
      if (data.file_id) {
        setUploadedFilesMap((prev) => ({ ...prev, [data.file_id]: data }))
      }
      fetchUploadHistory()
    } catch (err) { setError(err.message) }
    e.target.value = ''
  }

  // ===== Feature 5: Coverage Report =====
  const fetchCoverageReport = async () => {
    // Toggle: if already showing, hide it
    if (coverageReport) {
      setCoverageReport(null)
      setShowCoverageDetails(false)
      return
    }
    if (!uploadResult || !uploadResult.genes || uploadResult.genes.length === 0) return
    setCoverageLoading(true)
    try {
      const res = await fetch(`${API_BASE}/coverage-report`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ genes: uploadResult.genes, aliases_map: {} }),
      })
      const data = await res.json()
      setCoverageReport(data)
    } catch (err) {
      setError('Failed to fetch coverage report: ' + err.message)
    } finally {
      setCoverageLoading(false)
    }
  }

  const fetchAmbiguity = async (symbol) => {
    try {
      const res = await fetch(`${API_BASE}/advanced/ambiguity`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gene_symbol: symbol }),
      })
      const data = await res.json()
      setAmbiguityData(data)
    } catch {
      setAmbiguityData(null)
    }
  }

  const fetchGeneFamily = async (symbol) => {
    try {
      const res = await fetch(`${API_BASE}/advanced/gene-family`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gene_symbol: symbol }),
      })
      const data = await res.json()
      setFamilyData(data)
      setShowFamilyMembers(false)
    } catch {
      setFamilyData(null)
    }
  }

  const fetchGenomicContext = async (symbols) => {
    const genes = Array.isArray(symbols) ? symbols : [symbols]
    setGenomicContextLoading(true)
    setGenomicContextMap({})
    const results = {}
    await Promise.all(genes.map(async (gene) => {
      try {
        const res = await fetch(`${API_BASE}/advanced/genomic-context`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gene_symbol: gene }),
        })
        const data = await res.json()
        if (data && data.chromosome) {
          const neighbors = (data.neighbors || []).map(n => ({
            ...n,
            gene_symbol: n.gene_symbol || n.symbol || '',
            full_name: n.full_name || n.name || '',
          }))
          const upstream = neighbors.filter(n => n.direction === 'upstream').sort((a, b) => (b.distance_kb || 0) - (a.distance_kb || 0))
          const downstream = neighbors.filter(n => n.direction === 'downstream').sort((a, b) => (a.distance_kb || 0) - (b.distance_kb || 0))
          results[gene] = { ...data, neighbors: [...upstream, ...downstream] }
        }
      } catch { /* fail silently per gene */ }
    }))
    setGenomicContextMap(results)
    setGenomicContextLoading(false)
  }

  const fetchFunctionalExpansion = async (symbols) => {
    const genes = Array.isArray(symbols) ? symbols : [symbols]
    setFunctionalExpansionLoading(true)
    setFunctionalExpansionMap({})
    const results = {}
    await Promise.all(genes.map(async (gene) => {
      try {
        const res = await fetch(`${API_BASE}/advanced/functional-expansion`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ gene_symbol: gene }),
        })
        const data = await res.json()
        if (data && data.associations && Array.isArray(data.associations) && data.associations.length > 0) {
          const associations = data.associations.map(a => ({
            ...a,
            gene_symbol: a.gene_symbol || a.gene || '',
            relationship_type: a.relationship_type || a.relationship || '',
            pathway_name: a.pathway_name || a.pathway || '',
          }))
          results[gene] = { ...data, associations }
        }
      } catch { /* fail silently per gene */ }
    }))
    setFunctionalExpansionMap(results)
    setFunctionalExpansionLoading(false)
  }

  const searchGene = useCallback(async (symbol) => {
    const query = symbol || geneSymbol
    if (!query.trim()) return
    setLoading(true)
    setError(null)
    setResult(null)
    setResultMap({})
    setAmbiguityData(null)
    setOrthologInfo(null)
    setFamilyData(null)
    setShowFamilyMembers(false)
    setGenomicContextMap({})
    setFunctionalExpansionMap({})
    setExpandedGenes({})
    setMultiGeneLoading(false)

    const genes = parseGeneInput(query.trim())
    const isMultiGene = genes.length > 1

    try {
      if (isMultiGene) {
        // Multi-gene: send parallel requests for each gene
        setMultiGeneLoading(true)
        const newResultMap = {}
        const searchPromises = genes.map(async (gene) => {
          try {
            const searchBody = { gene_symbol: gene }
            if (crossSpecies) {
              searchBody.cross_species = true
            }
            const response = await fetch(`${API_BASE}/search`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(searchBody),
            })
            if (!response.ok) { const d = await response.json(); throw new Error(d.detail || `HTTP ${response.status}`) }
            const data = await response.json()
            newResultMap[gene] = data
            // Update resultMap progressively as results come in
            setResultMap(prev => ({ ...prev, [gene]: data }))
          } catch (err) {
            // Store error as result for this gene
            newResultMap[gene] = { query: gene, error: err.message, aliases: [], matches: [], total_matches: 0 }
            setResultMap(prev => ({ ...prev, [gene]: { query: gene, error: err.message, aliases: [], matches: [], total_matches: 0 } }))
          }
        })
        await Promise.all(searchPromises)
        setMultiGeneLoading(false)

        // Set expandedGenes: first gene expanded by default
        const init = {}
        genes.forEach((g, i) => { init[g] = i === 0 })
        setExpandedGenes(init)

        // Add each gene to history separately
        setHistory((prev) => {
          let updated = [...prev]
          genes.forEach(gene => {
            const r = newResultMap[gene]
            if (r && !updated.find(h => h.query === r.query)) {
              updated.unshift({ query: r.query, total: r.total_matches || 0, time: new Date().toLocaleTimeString() })
            }
          })
          return updated.slice(0, 10)
        })

        // For multi-gene: only fetch ambiguity/family for the first gene (or skip)
        // Skipping for multi-gene to avoid confusion

        // Genomic Context (fire and forget) — all genes
        fetchGenomicContext(genes)

        // Functional Expansion (fire and forget) — all genes
        fetchFunctionalExpansion(genes)
      } else {
        // Single gene: keep existing behavior exactly
        const searchBody = { gene_symbol: query.trim() }
        // Feature 2: Cross-Species
        if (crossSpecies) {
          searchBody.cross_species = true
        }

        const response = await fetch(`${API_BASE}/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(searchBody),
        })
        if (!response.ok) { const d = await response.json(); throw new Error(d.detail || `HTTP ${response.status}`) }
        const data = await response.json()
        setResult(data)
        setResultMap({ [data.query]: data })

        // Feature 2: Check for ortholog_info in results
        if (data.ortholog_info) {
          setOrthologInfo(data.ortholog_info)
        }

        setHistory((prev) => {
          if (prev.find((h) => h.query === data.query)) return prev
          return [{ query: data.query, total: data.total_matches, time: new Date().toLocaleTimeString() }, ...prev].slice(0, 10)
        })

        // Feature 1: Ambiguity Resolver (fire and forget)
        fetchAmbiguity(query.trim())

        // Feature 5: Gene Family Suggestion (fire and forget)
        fetchGeneFamily(query.trim())

        // Genomic Context (fire and forget)
        fetchGenomicContext(genes)

        // Functional Expansion (fire and forget)
        fetchFunctionalExpansion(genes)

        // Refresh quota after search
        fetch(`${API_BASE}/quota`).then(r => r.json()).then(setQuota).catch(() => {})
      }
    } catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }, [geneSymbol, crossSpecies])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      const genes = parseGeneInput(geneSymbol)
      if (genes.length > MAX_GENES) {
        setError(`Maximum ${MAX_GENES} genes allowed. You entered ${genes.length}.`)
        return
      }
      searchGene()
    }
  }
  const progressPercent = genProgress.total > 0 ? Math.round((genProgress.completed / genProgress.total) * 100) : 0

  // ===== Coverage helpers =====
  const getCoverageStats = () => {
    if (!coverageReport) return null
    const details = coverageReport.details || []
    const total = details.length
    const direct = details.filter(d => d.status === 'direct_match' || d.status === 'Direct Match').length
    const alias = details.filter(d => d.status === 'alias_match' || d.status === 'Alias Match').length
    const unmatched = total - direct - alias
    return { total, direct, alias, unmatched }
  }

  const mgiUrl = (gene) => `https://www.informatics.jax.org/search?q=${encodeURIComponent(gene)}`

  // ===== Gene limit selector options =====
  const limitOptions = [
    { value: 50, label: '50', disabled: false },
    { value: 100, label: '100', disabled: false },
    { value: 1000, label: '1,000', disabled: true },
    { value: 5000, label: '5,000', disabled: true },
  ]

  // ===== Estimated time helper =====
  const getEstimatedTime = (limit) => {
    // 初始预估：基于保守估计每批 60 秒
    const totalSeconds = Math.ceil(limit / 20) * 60
    if (totalSeconds < 60) {
      return `~1 min`
    }
    const min = Math.floor(totalSeconds / 60)
    const sec = totalSeconds % 60
    return sec > 0 ? `~${min} min ${sec} sec` : `~${min} min`
  }

  // 格式化秒数为时间字符串
  const formatTime = (seconds) => {
    if (seconds < 60) {
      return `${seconds} sec`
    }
    const min = Math.floor(seconds / 60)
    const sec = seconds % 60
    return sec > 0 ? `${min} min ${sec} sec` : `${min} min`
  }

  // ===== Format upload time =====
  const formatUploadTime = (dateStr) => {
    if (!dateStr) return ''
    try {
      const d = new Date(dateStr)
      return d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return dateStr
    }
  }

  // ===== Truncate filename =====
  const truncateFilename = (name, maxLen = 24) => {
    if (!name || name.length <= maxLen) return name
    const ext = name.lastIndexOf('.')
    if (ext > 0) {
      const base = name.substring(0, ext)
      const extension = name.substring(ext)
      const truncatedBase = base.substring(0, maxLen - extension.length - 3)
      return `${truncatedBase}...${extension}`
    }
    return `${name.substring(0, maxLen - 3)}...`
  }

  // ===== Gene limit selector component =====
  const GeneLimitSelector = () => (
    <div className="limit-selector">
      <div className="limit-label">Number of genes</div>
      <div className="limit-pills">
        {limitOptions.map((opt) => (
          <button
            key={opt.value}
            className={`limit-option ${dbGeneLimit === opt.value ? 'selected' : ''} ${opt.disabled ? 'disabled' : ''}`}
            onClick={() => !opt.disabled && setDbGeneLimit(opt.value)}
            disabled={opt.disabled || genStatus === 'running'}
            title={opt.disabled ? 'Coming soon' : undefined}
          >
            {opt.label}
            {opt.disabled && <span className="limit-option-badge">Soon</span>}
          </button>
        ))}
        <button
          className="limit-option disabled"
          disabled={true}
          title="Coming soon"
        >
          All ({dbGeneCount.toLocaleString()})
          <span className="limit-option-badge">Soon</span>
        </button>
      </div>
      <div className="limit-estimate">
        Estimated time: {getEstimatedTime(dbGeneLimit)}
      </div>
    </div>
  )

  // ===== Computed values for multi-file selection =====
  const selectedFileIdsArr = Array.from(selectedFileIds)
  const totalSelectedGenes = uploadHistory
    .filter((f) => selectedFileIds.has(f.file_id))
    .reduce((sum, f) => sum + (f.gene_count || 0), 0)

  return (
    <div className="app">
      {/* ===== Header ===== */}
      <header className="header">
        <div className="header-inner">
          <div className="header-brand">
            <div className="logo">🧬</div>
            <div>
              <h1>BSCA</h1>
              <p className="header-tagline">Biology Symbol Conversion Agent</p>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {quota && quota.daily_remaining !== undefined && (
              <div className="quota-badge" title={`Daily quota: ${quota.daily_used}/${quota.daily_used + quota.daily_remaining} used`}>
                <span className="quota-icon">⚡</span>
                <span className="quota-text">{quota.daily_remaining}/{quota.daily_quota}</span>
              </div>
            )}
            <div className="header-badge">Powered by LLM</div>
          </div>
        </div>
      </header>

      <main className="main">
        {/* ===== Search Section ===== */}
        <section className="card search-card">
          <div className="card-header">
            <h2>Gene Symbol Search</h2>
            <p>Enter a gene symbol to find aliases and match against single-cell datasets</p>
          </div>
          <div className="search-bar">
            {/* Comparison List Chips */}
            {comparisonList.length > 0 && (
              <div className="comparison-chips-bar">
                <span className="comparison-chips-label">Comparison:</span>
                <div className="comparison-chips">
                  {comparisonList.map((gene) => (
                    <span key={gene} className="comparison-chip">
                      <button
                        className="comparison-chip-link"
                        onClick={() => { setGeneSymbol(gene); searchGene(gene) }}
                        disabled={loading || multiGeneLoading}
                      >
                        {gene}
                      </button>
                      <button
                        className="comparison-chip-remove"
                        onClick={() => setComparisonList((prev) => prev.filter((g) => g !== gene))}
                        title={`Remove ${gene}`}
                        disabled={loading || multiGeneLoading}
                      >
                        &times;
                      </button>
                    </span>
                  ))}
                  <button
                    className="comparison-clear-btn"
                    onClick={() => setComparisonList([])}
                  >
                    Clear all
                  </button>
                </div>
              </div>
            )}
            <div className="search-input-wrapper">
              <svg className="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
              <input type="text" value={geneSymbol} onChange={(e) => setGeneSymbol(e.target.value)}
                onKeyDown={handleKeyDown} placeholder="e.g. TP53, HER2, P53, c-MYC..."
                className="search-input" disabled={loading || multiGeneLoading} />
              {/* Feature 2: Cross-Species Toggle */}
              <label className="cross-species-toggle" title="Enable cross-species mapping">
                <input
                  type="checkbox"
                  checked={crossSpecies}
                  onChange={(e) => setCrossSpecies(e.target.checked)}
                  disabled={loading}
                />
                <span className="toggle-slider" />
                <span className="toggle-label">Cross-Species</span>
              </label>
              <button onClick={() => {
                const genes = parseGeneInput(geneSymbol)
                if (genes.length > MAX_GENES) {
                  setError(`Maximum ${MAX_GENES} genes allowed. You entered ${genes.length}.`)
                  return
                }
                searchGene()
              }} disabled={loading || multiGeneLoading || !geneSymbol.trim()} className="search-btn">
                {(loading || multiGeneLoading) ? <span className="spinner-sm" /> : 'Search'}
              </button>
            </div>
            <div className="quick-tags">
              <span className="quick-label">Quick:</span>
              {['TP53', 'HER2', 'P53', 'c-MYC', 'VEGFA'].map((ex) => (
                <button key={ex} className="quick-tag" onClick={() => { setGeneSymbol(ex); searchGene(ex) }} disabled={loading || multiGeneLoading}>{ex}</button>
              ))}
            </div>
          </div>
        </section>

        {/* ===== Error ===== */}
        {error && (
          <div className="alert alert-error">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
            <span>{error}</span>
          </div>
        )}

        {/* ===== Two Column Layout ===== */}
        <div className="two-col">
          {/* Left Column */}
          <div className="col-left">
            {/* Upload Card */}
            <section className="card upload-card">
              <div className="card-header">
                <h2>Upload Gene List</h2>
                <p>Upload a file with gene symbols (one per line)</p>
              </div>
              <div className="upload-zone" onClick={() => document.getElementById('file-input').click()}>
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                <span className="upload-text">Click to upload or drag & drop</span>
                <span className="upload-formats">.txt .csv .xlsx .docx</span>
                <input id="file-input" type="file" accept=".txt,.csv,.xlsx,.docx" onChange={handleFileUpload} hidden />
              </div>

              {/* ===== Upload History ===== */}
              {uploadHistory.length > 0 && (
                <div className="upload-history">
                  <div className="upload-history-header">
                    <span className="upload-history-title">Upload History</span>
                    <span className="upload-history-count">{uploadHistory.length} file{uploadHistory.length !== 1 ? 's' : ''}</span>
                  </div>
                  <div className="upload-history-list">
                    {uploadHistory.map((item) => (
                        <div key={item.file_id} className="upload-history-item">
                          <div className="upload-history-item-info">
                            <span className="upload-history-filename" title={item.filename}>
                              {truncateFilename(item.filename)}
                            </span>
                            <span className="upload-history-gene-badge">{item.gene_count || 0} genes</span>
                          </div>
                          <div className="upload-history-item-actions">
                            <span className="upload-history-time">{formatUploadTime(item.uploaded_at)}</span>
                            <button
                              className="upload-history-load-btn"
                              onClick={() => loadFileFromHistory(item.file_id)}
                              title={uploadedFilesMap[item.file_id] ? 'Load this file' : 'Data not available — please re-upload'}
                            >
                              Load
                            </button>
                          </div>
                        </div>
                    ))}
                  </div>
                </div>
              )}

              {uploadResult && (
                <div className="upload-result">
                  <div className="upload-meta">
                    <div className="meta-item">
                      <span className="meta-label">File</span>
                      <span className="meta-value">{uploadResult.filename}</span>
                    </div>
                    <div className="meta-item">
                      <span className="meta-label">Total Lines</span>
                      <span className="meta-value">{uploadResult.total_lines}</span>
                    </div>
                    <div className="meta-item">
                      <span className="meta-label">Genes Parsed</span>
                      <span className="meta-value highlight">{uploadResult.gene_count}</span>
                    </div>
                  </div>

                  {/* Feature 6: Data Cleaning Preview */}
                  {uploadResult.issues_count > 0 && (
                    <div className="cleaning-preview-section">
                      <div className="alert alert-warning alert-sm">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                        <span><strong>{uploadResult.issues_count}</strong> potential issue{uploadResult.issues_count !== 1 ? 's' : ''} detected</span>
                      </div>
                      <button className="expand-btn" onClick={() => setShowCleaningPreview(!showCleaningPreview)}>
                        {showCleaningPreview ? 'Hide issues' : 'Review Issues'}
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: showCleaningPreview ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}><polyline points="6 9 12 15 18 9"/></svg>
                      </button>
                      {showCleaningPreview && uploadResult.cleaning_details && (
                        <div className="cleaning-table-wrapper">
                          <table className="cleaning-table">
                            <thead>
                              <tr>
                                <th>Original</th>
                                <th>Cleaned</th>
                                <th>Issue</th>
                                <th>Fix</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(uploadResult.cleaning_details || []).map((row, i) => (
                                <tr key={i} className={row.issue ? 'row-issue' : 'row-clean'}>
                                  <td><code>{row.original}</code></td>
                                  <td><code>{row.cleaned}</code></td>
                                  <td>{row.issue || '-'}</td>
                                  <td>{row.fix || '-'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}

                  <button className="expand-btn" onClick={() => setShowGeneList(!showGeneList)}>
                    {showGeneList ? 'Hide gene list' : `Show gene list (${uploadResult.gene_count})`}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: showGeneList ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}><polyline points="6 9 12 15 18 9"/></svg>
                  </button>
                  {showGeneList && (
                    <div className="gene-grid">
                      {uploadResult.genes.map((gene, i) => <span key={i} className="gene-tag">{gene}</span>)}
                    </div>
                  )}

                  {/* Feature 5: Coverage Report Button */}
                  <div className="coverage-check-section">
                    <button
                      className="btn btn-outline btn-coverage"
                      onClick={fetchCoverageReport}
                      disabled={coverageLoading || !uploadResult.genes || uploadResult.genes.length === 0}
                    >
                      {coverageLoading ? <><span className="spinner-sm spinner-sm-outline" /> Checking...</> : (
                        <>
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>
                          {coverageReport ? 'Hide Coverage' : 'Check Coverage'}
                        </>
                      )}
                    </button>
                  </div>

                  {/* Feature 5: Coverage Report Display */}
                  {coverageReport && (() => {
                    const stats = getCoverageStats()
                    if (!stats) return null
                    const directPct = stats.total > 0 ? (stats.direct / stats.total) * 100 : 0
                    const aliasPct = stats.total > 0 ? (stats.alias / stats.total) * 100 : 0
                    const unmatchedPct = stats.total > 0 ? (stats.unmatched / stats.total) * 100 : 0
                    return (
                      <div className="coverage-report">
                        {/* Stacked Coverage Bar */}
                        <div className="coverage-bar-track">
                          {directPct > 0 && (
                            <div className="coverage-bar-segment coverage-bar-direct" style={{ width: `${directPct}%` }} title={`Direct: ${directPct.toFixed(1)}%`} />
                          )}
                          {aliasPct > 0 && (
                            <div className="coverage-bar-segment coverage-bar-alias" style={{ width: `${aliasPct}%` }} title={`Alias: ${aliasPct.toFixed(1)}%`} />
                          )}
                          {unmatchedPct > 0 && (
                            <div className="coverage-bar-segment coverage-bar-unmatched" style={{ width: `${unmatchedPct}%` }} title={`Unmatched: ${unmatchedPct.toFixed(1)}%`} />
                          )}
                        </div>

                        {/* Stat Cards */}
                        <div className="coverage-stats">
                          <div className="coverage-stat-card">
                            <span className="coverage-stat-value">{stats.total}</span>
                            <span className="coverage-stat-label">Total</span>
                          </div>
                          <div className="coverage-stat-card coverage-stat-direct">
                            <span className="coverage-stat-value">{stats.direct}</span>
                            <span className="coverage-stat-label">Direct</span>
                          </div>
                          <div className="coverage-stat-card coverage-stat-alias">
                            <span className="coverage-stat-value">{stats.alias}</span>
                            <span className="coverage-stat-label">Alias</span>
                          </div>
                          <div className="coverage-stat-card coverage-stat-unmatched">
                            <span className="coverage-stat-value">{stats.unmatched}</span>
                            <span className="coverage-stat-label">Unmatched</span>
                          </div>
                        </div>

                        {/* View Details Toggle */}
                        <button className="expand-btn" onClick={() => setShowCoverageDetails(!showCoverageDetails)}>
                          {showCoverageDetails ? 'Hide details' : 'View Details'}
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: showCoverageDetails ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}><polyline points="6 9 12 15 18 9"/></svg>
                        </button>

                        {/* Details Table */}
                        {showCoverageDetails && coverageReport.details && (
                          <div className="coverage-table-wrapper">
                            <table className="coverage-table">
                              <thead>
                                <tr>
                                  <th>Gene</th>
                                  <th>Status</th>
                                  <th>MGI</th>
                                </tr>
                              </thead>
                              <tbody>
                                {coverageReport.details.map((row, i) => (
                                  <tr key={i} className={
                                    row.status === 'direct_match' || row.status === 'Direct Match' ? 'coverage-row-direct' :
                                    row.status === 'alias_match' || row.status === 'Alias Match' ? 'coverage-row-alias' :
                                    'coverage-row-unmatched'
                                  }>
                                    <td><code>{row.gene || row.gene_symbol || '-'}</code></td>
                                    <td>
                                      <span className={`coverage-status-badge ${
                                        row.status === 'direct_match' || row.status === 'Direct Match' ? 'status-direct' :
                                        row.status === 'alias_match' || row.status === 'Alias Match' ? 'status-alias' :
                                        'status-unmatched'
                                      }`}>
                                        {row.status === 'direct_match' || row.status === 'Direct Match' ? 'Direct' :
                                         row.status === 'alias_match' || row.status === 'Alias Match' ? 'Alias' :
                                         'Unmatched'}
                                      </span>
                                    </td>
                                    <td>
                                      <a
                                        className="mgi-link"
                                        href={mgiUrl(row.gene || row.gene_symbol || '')}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        title={`Search ${row.gene || row.gene_symbol} on MGI`}
                                      >
                                        ↗
                                      </a>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )
                  })()}
                </div>
              )}
            </section>

            {/* Generation Card */}
            <section className="card gen-card">
              <div className="card-header">
                <h2>Aliases Generation</h2>
                <p>Batch generate gene aliases using LLM</p>
              </div>

              {/* Gene Limit Selector — shown when no file is uploaded */}
              {(!uploadResult || uploadResult.gene_count === 0) && (
                <div className="gen-limit-section">
                  <GeneLimitSelector />
                </div>
              )}

              {/* Output Type Selector */}
              <div className="output-type-section">
                <div className="output-type-label">Output Columns</div>
                <div className="output-type-pills">
                  {[
                    { value: 'aliases', label: 'Aliases', locked: true },
                    { value: 'symbol', label: 'Symbol', locked: true },
                    { value: 'ensembl_id', label: 'Ensembl ID', locked: false },
                    { value: 'uniprot', label: 'UniProt', locked: false },
                    { value: 'entrez_id', label: 'Entrez ID', locked: false },
                  ].map((opt) => {
                    const isSelected = outputTypes.includes(opt.value)
                    const isLocked = opt.locked
                    return (
                      <button
                        key={opt.value}
                        className={`output-type-pill ${isSelected ? 'selected' : ''} ${isLocked ? 'locked' : ''}`}
                        onClick={() => {
                          if (isLocked) return
                          setOutputTypes((prev) =>
                            prev.includes(opt.value)
                              ? prev.filter((t) => t !== opt.value)
                              : [...prev, opt.value]
                          )
                        }}
                        disabled={isLocked}
                        title={isLocked ? 'Required column' : undefined}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
                <div className="output-type-note">CSV will include selected columns + Status + MGI Link</div>
              </div>

              <div className="gen-actions">
                <button className="btn btn-primary" onClick={handleGenerateClick} disabled={genStatus === 'running'}>
                  {genStatus === 'running' ? <><span className="spinner-sm" /> Generating...</> : 'Start Generation'}
                </button>
                <button className="btn btn-outline" onClick={downloadCSV} disabled={genStatus !== 'done'}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                  Download CSV
                </button>
              </div>

              {/* Feature 4: Provenance Status note */}
              {genStatus === 'done' && (
                <div className="provenance-note">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                  <span>CSV includes Provenance Status column (Exact Match / Alias Match / Not Found)</span>
                </div>
              )}

              {genStatus === 'running' && (
                <div className="progress-section">
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
                  </div>
                  <div className="progress-label">
                    {genProgress.completed.toLocaleString()} / {genProgress.total.toLocaleString()} genes
                    <span className="progress-pct">{progressPercent}%</span>
                  </div>
                  {genProgress.estimated_remaining > 0 && (
                    <div className="progress-estimate">
                      Est. remaining: {formatTime(genProgress.estimated_remaining)}
                      <span className="progress-estimate-detail">({genProgress.avg_batch_time}s/batch)</span>
                    </div>
                  )}
                </div>
              )}

              {genStatus === 'done' && (
                <div className="alert alert-success">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                  <span>Completed — <strong>{genProgress.total.toLocaleString()}</strong> genes processed, <strong>{genProgress.results_count.toLocaleString()}</strong> aliases generated.</span>
                </div>
              )}

              {genStatus === 'error' && (
                <div className="alert alert-error">
                  <span>An error occurred during generation. Please try again.</span>
                </div>
              )}
            </section>
          </div>

          {/* Right Column — Results */}
          <div className="col-right">
            {/* Multi-gene loading indicator */}
            {multiGeneLoading && (
              <div className="feature-loading-indicator">
                <span className="spinner-sm spinner-sm-outline" />
                <span>Searching {parseGeneInput(geneSymbol).length} genes... ({Object.keys(resultMap).length} completed)</span>
              </div>
            )}

            {/* Search Results */}
            {(result || Object.keys(resultMap).length > 0) && (
              <>
                {/* Multi-gene search results accordion */}
                {!result && Object.keys(resultMap).length > 1 && (
                  <section className="card result-card">
                    <div className="card-header compact">
                      <h2>Search Results <span className="gene-count-badge">{Object.keys(resultMap).length} gene{Object.keys(resultMap).length !== 1 ? 's' : ''}</span></h2>
                    </div>
                    <div className="gene-accordion">
                      {Object.entries(resultMap).map(([geneName, geneResult]) => {
                        const isExpanded = expandedGenes[geneName] !== false
                        return (
                          <div key={geneName} className="gene-accordion-item">
                            <div
                              className={`gene-accordion-header ${isExpanded ? 'expanded' : ''}`}
                              onClick={() => toggleGeneExpand(geneName)}
                            >
                              <span className="gene-accordion-header-text">
                                <strong>{geneName}</strong>
                                <span className="gene-accordion-header-meta">
                                  {geneResult.error
                                    ? `Error: ${geneResult.error}`
                                    : `${geneResult.total_matches} match${geneResult.total_matches !== 1 ? 'es' : ''}`
                                  }
                                </span>
                              </span>
                              <svg className={`gene-accordion-chevron ${isExpanded ? 'expanded' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
                            </div>
                            <div className={`gene-accordion-body ${isExpanded ? '' : 'collapsed'}`}>
                              {geneResult.error ? (
                                <div className="empty-state">
                                  <p>{geneResult.error}</p>
                                </div>
                              ) : (
                                <>
                                  {/* Aliases */}
                                  <div className="result-block">
                                    <h3>Identified Aliases</h3>
                                    <div className="alias-list">
                                      <span className="alias-chip primary">{geneResult.query}</span>
                                      {geneResult.aliases.filter((a) => a.toLowerCase() !== geneResult.query.toLowerCase()).map((alias, i) => (
                                        <span key={i} className="alias-chip">{alias}</span>
                                      ))}
                                    </div>
                                  </div>

                                  {/* Matches */}
                                  <div className="result-block">
                                    <h3>Dataset Matches <span className="badge muted">{geneResult.total_matches}</span></h3>
                                    {geneResult.matches.length > 0 ? (
                                      <div className="match-list">
                                        {geneResult.matches.map((match, i) => (
                                          <div key={i} className="match-row">
                                            <div className="match-top">
                                              <div className="match-gene-wrapper">
                                                <code className="match-gene">{match.gene_name}</code>
                                                <a
                                                  className="mgi-link mgi-link-inline"
                                                  href={mgiUrl(match.gene_name)}
                                                  target="_blank"
                                                  rel="noopener noreferrer"
                                                  title={`Search ${match.gene_name} on MGI`}
                                                >
                                                  ↗
                                                </a>
                                              </div>
                                              <span className={`match-type ${match.matched_terms.length > 1 ? 'alias' : 'direct'}`}>
                                                {match.matched_terms.length > 1 ? 'Alias Match' : 'Direct Match'}
                                              </span>
                                            </div>
                                            <div className="match-bottom">
                                              <span className="match-dataset">{match.dataset}</span>
                                              <span className="match-terms">via {match.matched_terms.join(', ')}</span>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <div className="empty-state">
                                        <p>No matching genes found in any dataset.</p>
                                      </div>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </section>
                )}

                {/* Single-gene search results (result is not null) */}
                {result && (
                <>
                {/* Feature 2: Cross-Species Info Bar */}
                {orthologInfo && (
                  <div className="alert alert-info">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
                    <span>Mapped from <strong>{orthologInfo.original_species}</strong> {orthologInfo.original_symbol} → Human <strong>{orthologInfo.human_symbol}</strong></span>
                  </div>
                )}

                {/* Feature 1: Ambiguity Resolver Warning */}
                {ambiguityData && ambiguityData.ambiguous && (
                  <div className="ambiguity-panel">
                    <div className="ambiguity-header">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                      <span><strong>Ambiguous Symbol</strong> — Multiple genes match "{result.query}". Please confirm the correct one:</span>
                    </div>
                    {ambiguityData.candidates && ambiguityData.candidates.length > 0 && (
                      <div className="ambiguity-candidates">
                        {ambiguityData.candidates.map((candidate, i) => (
                          <div key={i} className="ambiguity-candidate-row">
                            <div className="candidate-main">
                              <code className="candidate-symbol">{candidate.symbol}</code>
                              <span className="candidate-name">{candidate.name}</span>
                            </div>
                            <div className="candidate-meta">
                              {candidate.chromosome && <span className="candidate-chr">Chr {candidate.chromosome}</span>}
                              {candidate.description && <span className="candidate-desc">{candidate.description}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <section className="card result-card">
                  <div className="card-header compact">
                    <h2>Search Results</h2>
                    <span className="badge">{result.query}</span>
                  </div>

                  {/* Aliases */}
                  <div className="result-block">
                    <h3>Identified Aliases</h3>
                    <div className="alias-list">
                      <span className="alias-chip primary">{result.query}</span>
                      {result.aliases.filter((a) => a.toLowerCase() !== result.query.toLowerCase()).map((alias, i) => (
                        <span key={i} className="alias-chip">{alias}</span>
                      ))}
                    </div>
                  </div>

                  {/* Matches */}
                  <div className="result-block">
                    <h3>Dataset Matches <span className="badge muted">{result.total_matches}</span></h3>
                    {result.matches.length > 0 ? (
                      <div className="match-list">
                        {result.matches.map((match, i) => (
                          <div key={i} className="match-row">
                            <div className="match-top">
                              <div className="match-gene-wrapper">
                                <code className="match-gene">{match.gene_name}</code>
                                {/* Feature 6: MGI link in search results */}
                                <a
                                  className="mgi-link mgi-link-inline"
                                  href={mgiUrl(match.gene_name)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  title={`Search ${match.gene_name} on MGI`}
                                >
                                  ↗
                                </a>
                              </div>
                              <span className={`match-type ${match.matched_terms.length > 1 ? 'alias' : 'direct'}`}>
                                {match.matched_terms.length > 1 ? 'Alias Match' : 'Direct Match'}
                              </span>
                            </div>
                            <div className="match-bottom">
                              <span className="match-dataset">{match.dataset}</span>
                              <span className="match-terms">via {match.matched_terms.join(', ')}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="empty-state">
                        <p>No matching genes found in any dataset.</p>
                      </div>
                    )}
                  </div>

                  {/* Feature 5: Gene Family Suggestion */}
                  {familyData && familyData.gene_family && familyData.gene_family !== 'None' && familyData.family_members && familyData.family_members.length > 0 && (
                    <div className="result-block gene-family-block">
                      <h3>Gene Family</h3>
                      <div className="family-info">
                        <span>This gene belongs to the <strong>{familyData.gene_family}</strong> family. Check other members?</span>
                        <button className="expand-btn" onClick={() => setShowFamilyMembers(!showFamilyMembers)}>
                          {showFamilyMembers ? 'Hide members' : `Show ${familyData.family_members.length} members`}
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ transform: showFamilyMembers ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}><polyline points="6 9 12 15 18 9"/></svg>
                        </button>
                      </div>
                      {showFamilyMembers && (
                        <div className="family-chips">
                          {familyData.family_members.map((member, i) => (
                            <button
                              key={i}
                              className="family-chip"
                              onClick={() => { setGeneSymbol(member); searchGene(member) }}
                              disabled={loading}
                            >
                              {member}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </section>
                </>
                )}

                {/* Genomic Context Loading Indicator */}
                {genomicContextLoading && (
                  <div className="feature-loading-indicator">
                    <span className="spinner-sm spinner-sm-outline" />
                    <span>Loading genomic context for {parseGeneInput(geneSymbol).length} gene{parseGeneInput(geneSymbol).length !== 1 ? 's' : ''}...</span>
                  </div>
                )}

                {/* Genomic Context Card — Multi-gene */}
                {Object.keys(genomicContextMap).length > 0 && (() => {
                  const geneEntries = Object.entries(genomicContextMap)
                  const geneCount = geneEntries.length
                  // Initialize expandedGenes: first gene expanded by default
                  if (geneCount > 0 && Object.keys(expandedGenes).length === 0) {
                    const init = {}
                    init[geneEntries[0][0]] = true
                    geneEntries.slice(1).forEach(([g]) => { init[g] = false })
                    // Use setTimeout to avoid setState during render
                    setTimeout(() => setExpandedGenes(init), 0)
                  }
                  return (
                    <section className="card genomic-context-card">
                      <div className="card-header compact">
                        <h2>Genomic Context <span className="gene-count-badge">{geneCount} gene{geneCount !== 1 ? 's' : ''}</span></h2>
                      </div>
                      <div className="genomic-context-body">
                        {geneCount === 1 ? (
                          /* Single gene — render directly */
                          (() => {
                            const [geneName, genomicContext] = geneEntries[0]
                            return (
                              <>
                                {/* Location Header */}
                                <div className="genomic-location-header">
                                  <span className="genomic-location-text">
                                    <strong>{geneName}</strong> — chr{genomicContext.chromosome}{genomicContext.cytoband || ''}
                                    {genomicContext.strand && (
                                      <span className="genomic-strand">({genomicContext.strand}) strand</span>
                                    )}
                                    {genomicContext.gene_span_kb != null && (
                                      <span className="genomic-span">| {genomicContext.gene_span_kb >= 1000 ? `${(genomicContext.gene_span_kb / 1000).toFixed(1)} Mb` : `${genomicContext.gene_span_kb.toFixed(1)} kb`}</span>
                                    )}
                                  </span>
                                </div>

                                {/* Mini Genomic Track */}
                                {genomicContext.neighbors && genomicContext.neighbors.length > 0 && (() => {
                                  const upstream = (genomicContext.neighbors || [])
                                    .filter(n => n.direction === 'upstream')
                                    .sort((a, b) => (a.distance_kb || 0) - (b.distance_kb || 0))
                                  const downstream = (genomicContext.neighbors || [])
                                    .filter(n => n.direction === 'downstream')
                                    .sort((a, b) => (a.distance_kb || 0) - (b.distance_kb || 0))

                                  const upMax = upstream.length > 0 ? Math.max(...upstream.map(n => n.distance_kb || 0)) : 0
                                  const downMax = downstream.length > 0 ? Math.max(...downstream.map(n => n.distance_kb || 0)) : 0
                                  const range = Math.max(upMax, downMax, 1)

                                  const markers = []
                                  upstream.forEach(n => markers.push({ pos: -(n.distance_kb || 0), neighbor: n, isQuery: false }))
                                  downstream.forEach(n => markers.push({ pos: (n.distance_kb || 0), neighbor: n, isQuery: false }))
                                  markers.push({ pos: 0, neighbor: null, isQuery: true })
                                  markers.sort((a, b) => a.pos - b.pos)

                                  const toPct = (pos) => 50 + (pos / range) * 45
                                  markers.forEach(m => { m.pct = toPct(m.pos) })

                                  const MIN_GAP = 7
                                  const topLanes = [[]]
                                  const bottomLanes = [[]]

                                  const findLane = (pct, lanes) => {
                                    for (let i = 0; i < lanes.length; i++) {
                                      if (lanes[i].every(p => Math.abs(pct - p) >= MIN_GAP)) return i
                                    }
                                    return -1
                                  }

                                  markers.forEach(m => {
                                    if (m.isQuery) {
                                      m.labelSide = 'top'
                                      m.labelLane = 0
                                      topLanes[0].push(m.pct)
                                      return
                                    }
                                    const topLane = findLane(m.pct, topLanes)
                                    const bottomLane = findLane(m.pct, bottomLanes)
                                    const topNeedsNew = topLane === -1
                                    const bottomNeedsNew = bottomLane === -1

                                    if (!topNeedsNew && (bottomNeedsNew || topLane <= bottomLane)) {
                                      m.labelSide = 'top'
                                      m.labelLane = topLane
                                      topLanes[topLane].push(m.pct)
                                    } else {
                                      m.labelSide = 'bottom'
                                      m.labelLane = bottomNeedsNew ? bottomLanes.length : bottomLane
                                      if (bottomNeedsNew) bottomLanes.push([m.pct])
                                      else bottomLanes[bottomLane].push(m.pct)
                                    }
                                  })

                                  const LANE_H = 22
                                  const topMaxLane = Math.max(...markers.map(m => m.labelSide === 'top' ? m.labelLane : 0))
                                  const bottomMaxLane = Math.max(...markers.map(m => m.labelSide === 'bottom' ? m.labelLane : 0))
                                  const padTop = (topMaxLane + 1) * LANE_H + 8
                                  const padBottom = (bottomMaxLane + 1) * LANE_H + 20

                                  return (
                                  <div className="genomic-track-section">
                                    <div className="genomic-track" style={{ paddingTop: `${padTop}px`, paddingBottom: `${padBottom}px` }}>
                                      <div className="genomic-axis" />

                                      {markers.map((m, i) => {
                                        const laneOffset = m.labelLane * LANE_H
                                        return (
                                          <div key={`m-${i}`} className="genomic-marker" style={{ left: `${m.pct}%` }}>
                                            <div className={`genomic-tick ${m.isQuery ? 'tick-query' : ''}`} />

                                            {m.labelLane > 0 && (
                                              <div className={`genomic-leader genomic-leader-${m.labelSide}`}
                                                style={{ height: `${laneOffset}px` }} />
                                            )}

                                            <div className={`genomic-marker-label genomic-label-${m.labelSide}`}
                                              style={{ [m.labelSide === 'top' ? 'bottom' : 'top']: `${8 + laneOffset}px` }}>
                                              {m.isQuery ? (
                                                <span className="genomic-query-name">{geneName}</span>
                                              ) : (
                                                <>
                                                  <button className="genomic-neighbor-label"
                                                    onClick={() => { setGeneSymbol(m.neighbor.gene_symbol); searchGene(m.neighbor.gene_symbol) }}
                                                    disabled={loading}
                                                  >{m.neighbor.gene_symbol}</button>
                                                  <span className="genomic-neighbor-distance">{Math.abs(m.pos)} kb</span>
                                                </>
                                              )}
                                            </div>
                                          </div>
                                        )
                                      })}

                                      <div className="genomic-scale">
                                        <span>-{range} kb</span>
                                        <span>0</span>
                                        <span>+{range} kb</span>
                                      </div>
                                    </div>
                                    <div className="genomic-track-legend">
                                      <span className="genomic-legend-upstream">&#8592; upstream</span>
                                      <span className="genomic-legend-downstream">downstream &#8594;</span>
                                    </div>
                                  </div>
                                  )
                                })()}

                                {/* Neighbor Details Table */}
                                {genomicContext.neighbors && genomicContext.neighbors.length > 0 && (
                                  <div className="genomic-neighbor-table-wrapper">
                                    <table className="genomic-neighbor-table">
                                      <thead>
                                        <tr>
                                          <th>Gene Symbol</th>
                                          <th>Full Name</th>
                                          <th>Distance</th>
                                          <th>Direction</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {genomicContext.neighbors.map((neighbor, i) => (
                                          <tr key={i}>
                                            <td>
                                              <button
                                                className="genomic-table-gene-link"
                                                onClick={() => { setGeneSymbol(neighbor.gene_symbol); searchGene(neighbor.gene_symbol) }}
                                                disabled={loading}
                                              >
                                                {neighbor.gene_symbol}
                                              </button>
                                            </td>
                                            <td className="genomic-table-name">{neighbor.full_name || '-'}</td>
                                            <td className="genomic-table-distance">{neighbor.distance_kb != null ? `${neighbor.distance_kb} kb` : '-'}</td>
                                            <td>
                                              <span className={`genomic-direction-badge ${neighbor.direction === 'upstream' ? 'direction-upstream' : 'direction-downstream'}`}>
                                                {neighbor.direction}
                                              </span>
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                )}
                              </>
                            )
                          })()
                        ) : (
                          /* Multiple genes — accordion */
                          <div className="gene-accordion">
                            {geneEntries.map(([geneName, genomicContext]) => {
                              const isExpanded = expandedGenes[geneName] !== false
                              return (
                                <div key={geneName} className="gene-accordion-item">
                                  <div
                                    className={`gene-accordion-header ${isExpanded ? 'expanded' : ''}`}
                                    onClick={() => toggleGeneExpand(geneName)}
                                  >
                                    <span className="gene-accordion-header-text">
                                      <strong>{geneName}</strong>
                                      <span className="gene-accordion-header-meta">
                                        chr{genomicContext.chromosome}{genomicContext.cytoband || ''}
                                        {genomicContext.strand && ` (${genomicContext.strand})`}
                                        {genomicContext.gene_span_kb != null && ` | ${genomicContext.gene_span_kb >= 1000 ? `${(genomicContext.gene_span_kb / 1000).toFixed(1)} Mb` : `${genomicContext.gene_span_kb.toFixed(1)} kb`}`}
                                      </span>
                                    </span>
                                    <svg className={`gene-accordion-chevron ${isExpanded ? 'expanded' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
                                  </div>
                                  <div className={`gene-accordion-body ${isExpanded ? '' : 'collapsed'}`}>
                                    {/* Location Header */}
                                    <div className="genomic-location-header">
                                      <span className="genomic-location-text">
                                        <strong>chr{genomicContext.chromosome}{genomicContext.cytoband || ''}</strong>
                                        {genomicContext.strand && (
                                          <span className="genomic-strand">({genomicContext.strand}) strand</span>
                                        )}
                                        {genomicContext.gene_span_kb != null && (
                                          <span className="genomic-span">| {genomicContext.gene_span_kb >= 1000 ? `${(genomicContext.gene_span_kb / 1000).toFixed(1)} Mb` : `${genomicContext.gene_span_kb.toFixed(1)} kb`}</span>
                                        )}
                                      </span>
                                    </div>

                                    {/* Mini Genomic Track */}
                                    {genomicContext.neighbors && genomicContext.neighbors.length > 0 && (() => {
                                      const upstream = (genomicContext.neighbors || [])
                                        .filter(n => n.direction === 'upstream')
                                        .sort((a, b) => (a.distance_kb || 0) - (b.distance_kb || 0))
                                      const downstream = (genomicContext.neighbors || [])
                                        .filter(n => n.direction === 'downstream')
                                        .sort((a, b) => (a.distance_kb || 0) - (b.distance_kb || 0))

                                      const upMax = upstream.length > 0 ? Math.max(...upstream.map(n => n.distance_kb || 0)) : 0
                                      const downMax = downstream.length > 0 ? Math.max(...downstream.map(n => n.distance_kb || 0)) : 0
                                      const range = Math.max(upMax, downMax, 1)

                                      const markers = []
                                      upstream.forEach(n => markers.push({ pos: -(n.distance_kb || 0), neighbor: n, isQuery: false }))
                                      downstream.forEach(n => markers.push({ pos: (n.distance_kb || 0), neighbor: n, isQuery: false }))
                                      markers.push({ pos: 0, neighbor: null, isQuery: true })
                                      markers.sort((a, b) => a.pos - b.pos)

                                      const toPct = (pos) => 50 + (pos / range) * 45
                                      markers.forEach(m => { m.pct = toPct(m.pos) })

                                      const MIN_GAP = 7
                                      const topLanes = [[]]
                                      const bottomLanes = [[]]

                                      const findLane = (pct, lanes) => {
                                        for (let i = 0; i < lanes.length; i++) {
                                          if (lanes[i].every(p => Math.abs(pct - p) >= MIN_GAP)) return i
                                        }
                                        return -1
                                      }

                                      markers.forEach(m => {
                                        if (m.isQuery) {
                                          m.labelSide = 'top'
                                          m.labelLane = 0
                                          topLanes[0].push(m.pct)
                                          return
                                        }
                                        const topLane = findLane(m.pct, topLanes)
                                        const bottomLane = findLane(m.pct, bottomLanes)
                                        const topNeedsNew = topLane === -1
                                        const bottomNeedsNew = bottomLane === -1

                                        if (!topNeedsNew && (bottomNeedsNew || topLane <= bottomLane)) {
                                          m.labelSide = 'top'
                                          m.labelLane = topLane
                                          topLanes[topLane].push(m.pct)
                                        } else {
                                          m.labelSide = 'bottom'
                                          m.labelLane = bottomNeedsNew ? bottomLanes.length : bottomLane
                                          if (bottomNeedsNew) bottomLanes.push([m.pct])
                                          else bottomLanes[bottomLane].push(m.pct)
                                        }
                                      })

                                      const LANE_H = 22
                                      const topMaxLane = Math.max(...markers.map(m => m.labelSide === 'top' ? m.labelLane : 0))
                                      const bottomMaxLane = Math.max(...markers.map(m => m.labelSide === 'bottom' ? m.labelLane : 0))
                                      const padTop = (topMaxLane + 1) * LANE_H + 8
                                      const padBottom = (bottomMaxLane + 1) * LANE_H + 20

                                      return (
                                      <div className="genomic-track-section">
                                        <div className="genomic-track" style={{ paddingTop: `${padTop}px`, paddingBottom: `${padBottom}px` }}>
                                          <div className="genomic-axis" />

                                          {markers.map((m, i) => {
                                            const laneOffset = m.labelLane * LANE_H
                                            return (
                                              <div key={`m-${i}`} className="genomic-marker" style={{ left: `${m.pct}%` }}>
                                                <div className={`genomic-tick ${m.isQuery ? 'tick-query' : ''}`} />

                                                {m.labelLane > 0 && (
                                                  <div className={`genomic-leader genomic-leader-${m.labelSide}`}
                                                    style={{ height: `${laneOffset}px` }} />
                                                )}

                                                <div className={`genomic-marker-label genomic-label-${m.labelSide}`}
                                                  style={{ [m.labelSide === 'top' ? 'bottom' : 'top']: `${8 + laneOffset}px` }}>
                                                  {m.isQuery ? (
                                                    <span className="genomic-query-name">{geneName}</span>
                                                  ) : (
                                                    <>
                                                      <button className="genomic-neighbor-label"
                                                        onClick={() => { setGeneSymbol(m.neighbor.gene_symbol); searchGene(m.neighbor.gene_symbol) }}
                                                        disabled={loading}
                                                      >{m.neighbor.gene_symbol}</button>
                                                      <span className="genomic-neighbor-distance">{Math.abs(m.pos)} kb</span>
                                                    </>
                                                  )}
                                                </div>
                                              </div>
                                            )
                                          })}

                                          <div className="genomic-scale">
                                            <span>-{range} kb</span>
                                            <span>0</span>
                                            <span>+{range} kb</span>
                                          </div>
                                        </div>
                                        <div className="genomic-track-legend">
                                          <span className="genomic-legend-upstream">&#8592; upstream</span>
                                          <span className="genomic-legend-downstream">downstream &#8594;</span>
                                        </div>
                                      </div>
                                      )
                                    })()}

                                    {/* Neighbor Details Table */}
                                    {genomicContext.neighbors && genomicContext.neighbors.length > 0 && (
                                      <div className="genomic-neighbor-table-wrapper">
                                        <table className="genomic-neighbor-table">
                                          <thead>
                                            <tr>
                                              <th>Gene Symbol</th>
                                              <th>Full Name</th>
                                              <th>Distance</th>
                                              <th>Direction</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {genomicContext.neighbors.map((neighbor, i) => (
                                              <tr key={i}>
                                                <td>
                                                  <button
                                                    className="genomic-table-gene-link"
                                                    onClick={() => { setGeneSymbol(neighbor.gene_symbol); searchGene(neighbor.gene_symbol) }}
                                                    disabled={loading}
                                                  >
                                                    {neighbor.gene_symbol}
                                                  </button>
                                                </td>
                                                <td className="genomic-table-name">{neighbor.full_name || '-'}</td>
                                                <td className="genomic-table-distance">{neighbor.distance_kb != null ? `${neighbor.distance_kb} kb` : '-'}</td>
                                                <td>
                                                  <span className={`genomic-direction-badge ${neighbor.direction === 'upstream' ? 'direction-upstream' : 'direction-downstream'}`}>
                                                    {neighbor.direction}
                                                  </span>
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </section>
                  )
                })()}

                {/* Functional Expansion Loading Indicator */}
                {functionalExpansionLoading && (
                  <div className="feature-loading-indicator">
                    <span className="spinner-sm spinner-sm-outline" />
                    <span>Loading functional associations for {parseGeneInput(geneSymbol).length} gene{parseGeneInput(geneSymbol).length !== 1 ? 's' : ''}...</span>
                  </div>
                )}

                {/* Functional Expansion Card — Multi-gene */}
                {Object.keys(functionalExpansionMap).length > 0 && (() => {
                  const geneEntries = Object.entries(functionalExpansionMap)
                  const geneCount = geneEntries.length
                  return (
                    <section className="card functional-expansion-card">
                      <div className="card-header compact">
                        <h2>Functional Associations <span className="gene-count-badge">{geneCount} gene{geneCount !== 1 ? 's' : ''}</span></h2>
                      </div>
                      <div className="functional-expansion-body">
                        {geneCount === 1 ? (
                          /* Single gene — render directly */
                          (() => {
                            const [geneName, functionalExpansion] = geneEntries[0]
                            return (
                              <>
                                <div className="functional-subtitle">Top {functionalExpansion.associations.length} Associated Genes</div>
                                <div className="functional-association-list">
                                  {functionalExpansion.associations.map((assoc, i) => (
                                    <div key={i} className="functional-association-row">
                                      <div className="functional-assoc-main">
                                        <button
                                          className="functional-assoc-gene"
                                          onClick={() => { setGeneSymbol(assoc.gene_symbol); searchGene(assoc.gene_symbol) }}
                                          disabled={loading}
                                        >
                                          {assoc.gene_symbol}
                                        </button>
                                        <span className="functional-assoc-relationship">{assoc.relationship_type || '-'}</span>
                                      </div>
                                      <div className="functional-assoc-meta">
                                        <span className="functional-assoc-pathway">{assoc.pathway_name || '-'}</span>
                                        <span className={`functional-confidence-badge confidence-${(assoc.confidence || '').toLowerCase()}`}>
                                          {assoc.confidence || 'unknown'}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                                <div className="functional-add-section">
                                  <button
                                    className="btn btn-outline btn-add-comparison"
                                    onClick={() => {
                                      const newGenes = functionalExpansion.associations
                                        .map(a => a.gene_symbol)
                                        .filter(g => !comparisonList.includes(g))
                                      setComparisonList(prev => [...prev, ...newGenes])
                                    }}
                                    disabled={functionalExpansion.associations.every(a => comparisonList.includes(a.gene_symbol))}
                                  >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                                    Add all to comparison list
                                  </button>
                                </div>
                              </>
                            )
                          })()
                        ) : (
                          /* Multiple genes — accordion */
                          <div className="gene-accordion">
                            {geneEntries.map(([geneName, functionalExpansion]) => {
                              const isExpanded = expandedGenes[geneName] !== false
                              return (
                                <div key={geneName} className="gene-accordion-item">
                                  <div
                                    className={`gene-accordion-header ${isExpanded ? 'expanded' : ''}`}
                                    onClick={() => toggleGeneExpand(geneName)}
                                  >
                                    <span className="gene-accordion-header-text">
                                      <strong>{geneName}</strong>
                                      <span className="gene-accordion-header-meta">
                                        {functionalExpansion.associations.length} association{functionalExpansion.associations.length !== 1 ? 's' : ''}
                                      </span>
                                    </span>
                                    <svg className={`gene-accordion-chevron ${isExpanded ? 'expanded' : ''}`} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"/></svg>
                                  </div>
                                  <div className={`gene-accordion-body ${isExpanded ? '' : 'collapsed'}`}>
                                    <div className="functional-subtitle">Top {functionalExpansion.associations.length} Associated Genes</div>
                                    <div className="functional-association-list">
                                      {functionalExpansion.associations.map((assoc, i) => (
                                        <div key={i} className="functional-association-row">
                                          <div className="functional-assoc-main">
                                            <button
                                              className="functional-assoc-gene"
                                              onClick={() => { setGeneSymbol(assoc.gene_symbol); searchGene(assoc.gene_symbol) }}
                                              disabled={loading}
                                            >
                                              {assoc.gene_symbol}
                                            </button>
                                            <span className="functional-assoc-relationship">{assoc.relationship_type || '-'}</span>
                                          </div>
                                          <div className="functional-assoc-meta">
                                            <span className="functional-assoc-pathway">{assoc.pathway_name || '-'}</span>
                                            <span className={`functional-confidence-badge confidence-${(assoc.confidence || '').toLowerCase()}`}>
                                              {assoc.confidence || 'unknown'}
                                            </span>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                    <div className="functional-add-section">
                                      <button
                                        className="btn btn-outline btn-add-comparison"
                                        onClick={() => {
                                          const newGenes = functionalExpansion.associations
                                            .map(a => a.gene_symbol)
                                            .filter(g => !comparisonList.includes(g))
                                          setComparisonList(prev => [...prev, ...newGenes])
                                        }}
                                        disabled={functionalExpansion.associations.every(a => comparisonList.includes(a.gene_symbol))}
                                      >
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                                        Add all to comparison list
                                      </button>
                                    </div>
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </section>
                  )
                })()}

                {/* History */}
                {history.length > 0 && (
                  <section className="card history-card">
                    <div className="card-header compact">
                      <h3>Recent Searches</h3>
                    </div>
                    <div className="history-list">
                      {history.map((h, i) => (
                        <button key={i} className="history-row" onClick={() => { setGeneSymbol(h.query); searchGene(h.query) }}>
                          <code>{h.query}</code>
                          <span className="history-meta">{h.total} dataset{h.total !== 1 ? 's' : ''} · {h.time}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}

            {/* Empty State */}
            {!result && Object.keys(resultMap).length === 0 && (
              <div className="card empty-card">
                <div className="empty-hero">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
                  <p>Enter a gene symbol to get started</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* ===== Modal ===== */}
      {showSourceModal && (
        <div className="modal-backdrop" onClick={() => { setShowSourceModal(false); setShowFileSelection(false); setSelectedFileIds(new Set()) }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {!showFileSelection ? (
              <>
                <h3>Select Data Source</h3>
                <p className="modal-sub">Choose where to generate aliases from:</p>
                <div className="modal-options">
                  <button className="modal-opt" onClick={() => setShowFileSelection(true)}>
                    <div className="modal-opt-icon">📁</div>
                    <div className="modal-opt-body">
                      <strong>Uploaded File</strong>
                      <span>{uploadHistory.length > 0 ? `${uploadHistory.length} file${uploadHistory.length !== 1 ? 's' : ''} available — select one or more` : 'No files uploaded yet'}</span>
                    </div>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                  </button>
                  <div className="modal-opt modal-opt-db">
                    <div className="modal-opt-icon">🗄️</div>
                    <div className="modal-opt-body">
                      <strong>Server Datasets</strong>
                      <span>Generate aliases from the server database</span>
                      <GeneLimitSelector />
                    </div>
                    <button
                      className="modal-opt-go"
                      onClick={() => doStartGeneration('database', dbGeneLimit)}
                      disabled={genStatus === 'running'}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                    </button>
                  </div>
                </div>
                <button className="modal-close" onClick={() => setShowSourceModal(false)}>Cancel</button>
              </>
            ) : (
              <>
                <h3>Select Files</h3>
                <p className="modal-sub">Choose uploaded files for alias generation:</p>

                {uploadHistory.length === 0 ? (
                  <div className="modal-file-empty">
                    <p>No uploaded files found. Please upload a gene list first.</p>
                  </div>
                ) : (
                  <>
                    <div className="modal-file-list">
                      {uploadHistory.map((item) => {
                        const isSelected = selectedFileIds.has(item.file_id)
                        return (
                          <label key={item.file_id} className={`modal-file-item ${isSelected ? 'selected' : ''}`}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleFileSelection(item.file_id)}
                              className="modal-file-checkbox"
                            />
                            <div className="modal-file-info">
                              <span className="modal-file-name" title={item.filename}>
                                {truncateFilename(item.filename, 30)}
                              </span>
                              <span className="modal-file-meta">{item.gene_count || 0} genes</span>
                            </div>
                          </label>
                        )
                      })}
                    </div>

                    {/* Selection summary */}
                    <div className="modal-file-summary">
                      {selectedFileIdsArr.length > 0 ? (
                        <span className="modal-file-summary-text">
                          {selectedFileIdsArr.length} file{selectedFileIdsArr.length !== 1 ? 's' : ''} selected ({totalSelectedGenes.toLocaleString()} genes total)
                        </span>
                      ) : (
                        <span className="modal-file-summary-text modal-file-summary-empty">
                          No files selected
                        </span>
                      )}
                    </div>

                    <div className="modal-file-actions">
                      <button
                        className="btn btn-outline"
                        onClick={() => setShowFileSelection(false)}
                      >
                        Back
                      </button>
                      <button
                        className="btn btn-primary"
                        onClick={() => doStartGeneration('uploaded', null, selectedFileIdsArr)}
                        disabled={selectedFileIdsArr.length === 0 || genStatus === 'running'}
                      >
                        {genStatus === 'running' ? <><span className="spinner-sm" /> Generating...</> : 'Start'}
                      </button>
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ===== Duplicate File Warning Modal ===== */}
      {duplicateModal && (
        <div className="modal-backdrop" onClick={() => setDuplicateModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>⚠️ File Already Uploaded</h3>
            <p className="modal-sub">
              <code>{duplicateModal.filename}</code> has already been uploaded.
            </p>
            <div className="duplicate-modal-actions">
              <button
                className="btn btn-outline"
                onClick={() => {
                  loadFileFromHistory(duplicateModal.existingFileId)
                  setDuplicateModal(null)
                }}
              >
                View Existing
              </button>
              <button
                className="btn btn-outline"
                onClick={() => setDuplicateModal(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== Footer ===== */}
      <footer className="footer">
        <p>BSCA — Biology Symbol Conversion Agent</p>
      </footer>
    </div>
  )
}

export default App
