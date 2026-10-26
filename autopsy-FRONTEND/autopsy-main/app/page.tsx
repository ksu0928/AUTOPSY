'use client'

import { useMemo, useRef, useState, useEffect } from 'react'
import { LineChart, Line, ResponsiveContainer, CartesianGrid, XAxis, YAxis, Tooltip, ReferenceLine, ReferenceArea } from 'recharts'
import { BarChart3, UploadCloud, Play, Copy, Check, Download, AlertCircle, Lock, Zap, Sparkles, FileJson, ArrowLeft, ArrowDownRight, ArrowUpRight, Info } from 'lucide-react'
import { parseCsv } from '@/lib/parse'
import { detectSchema } from '@/lib/schema'
import { aggregateByPeriod } from '@/lib/aggregate'
import { findAnomaly } from '@/lib/anomaly'
import { decompose, decomposeTwo } from '@/lib/decompose'
import { buildFacts } from '@/lib/facts'
import { templateAutopsy } from '@/lib/template'
import type { Facts, Autopsy, NarrateResponse, SchemaGuess, AnomalyResult, SegmentContribution, PeriodPoint } from '@/lib/types'

type AnalysisState = {
  schema: SchemaGuess
  metric: string
  windowSize: 4 | 6 | 8
  series: PeriodPoint[]
  anomaly: AnomalyResult
  contributions: SegmentContribution[]
  facts: Facts
  autopsy: Autopsy
  reportSource: 'llm' | 'template'
  reportNotice: string | null
  csvText: string
  fileName: string
  rows: number
  missingPct: number
  analysisTime: number
}

type ErrorInfo = {
  title: string
  message: string
  action?: string
}

// ============================================================================
// Backend Integration
// ============================================================================

async function narrateFromBackend(facts: Facts): Promise<NarrateResponse> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 15000)

  try {
    const response = await fetch('/api/narrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ facts }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (response.status === 429) {
      throw new Error('Rate limit exceeded')
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({}))
      throw new Error(body.error || `Server error`)
    }

    return await response.json()
  } catch (error) {
    clearTimeout(timeoutId)
    throw error
  }
}

// ============================================================================
// Components
// ============================================================================

function EmptyState({ onSample, onFile, loading }: { 
  onSample: (filename: string) => void
  onFile: (e: React.ChangeEvent<HTMLInputElement>) => void 
  loading: boolean
}) {
  const input = useRef<HTMLInputElement>(null)
  const [selectedSample, setSelectedSample] = useState('sample-signups.csv')
  const [dragOver, setDragOver] = useState(false)
  
  const samples = [
    { value: 'sample-signups.csv', label: 'Main Demo (4 anomalies, 45 weeks)', desc: 'Campaign pause, newsletter spike, organic decline, viral moment' },
    { value: 'sample-spike.csv', label: 'Clean Spike (11 weeks)', desc: 'Simple +50% spike in one segment' },
    { value: 'sample-multi-drop.csv', label: 'Multi-Segment Drop (11 weeks)', desc: 'Multiple segments drop simultaneously' },
  ]
  
  const selectedDesc = samples.find(s => s.value === selectedSample)?.desc || ''
  
  return (
    <main className="empty-state">
      <div className="empty-content">
        {/* A. Header */}
        <div className="empty-header">
          <div className="logo-mark">
            <BarChart3 size={24} strokeWidth={2} />
          </div>
          <h1 className="empty-title">Metric Autopsy</h1>
          <p className="empty-subtitle">
            Upload a CSV and find out why your metric moved, in seconds.
          </p>
          <div className="privacy-pill">
            <Lock size={12} />
            <span>Your raw data never leaves your browser</span>
          </div>
        </div>
        
        {/* B. Dropzone */}
        <label 
          className={`upload-zone ${dragOver ? 'drag-over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            const file = e.dataTransfer.files[0]
            if (file && !loading) {
              const reader = new FileReader()
              reader.onload = (ev) => {
                const text = ev.target?.result as string
                const fakeEvent = {
                  target: { files: [file] },
                  currentTarget: { files: [file] }
                } as React.ChangeEvent<HTMLInputElement>
                onFile(fakeEvent)
              }
              reader.readAsText(file)
            }
          }}
        >
          <div className="upload-icon">
            <UploadCloud size={20} />
          </div>
          <div className="upload-text">
            <strong>Click to upload</strong> or drag and drop
          </div>
          <div className="upload-helper">CSV up to 5 MB</div>
          <input 
            ref={input} 
            type="file" 
            accept=".csv" 
            onChange={onFile}
            disabled={loading}
            aria-label="Upload CSV file"
          />
        </label>
        
        {/* C. Divider */}
        <div className="sample-divider">or try a sample</div>
        
        {/* D. Sample picker */}
        <div className="sample-picker">
          <select 
            value={selectedSample} 
            onChange={(e) => setSelectedSample(e.target.value)}
            disabled={loading}
            aria-label="Select sample dataset"
          >
            {samples.map(s => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <button 
            className="sample-button" 
            onClick={() => onSample(selectedSample)}
            disabled={loading}
          >
            Load sample
          </button>
        </div>
        
        <p className="sample-description">{selectedDesc}</p>
      </div>
    </main>
  )
}

function LoadingState({ stage, elapsed }: { stage: string; elapsed: number }) {
  return (
    <main className="loading-state">
      <div className="loading-content">
        <div className="loading-spinner">
          <div className="spinner" />
        </div>
        <div className="loading-stage">{stage}</div>
        <div className="loading-elapsed">Elapsed: {elapsed.toFixed(1)}s</div>
      </div>
    </main>
  )
}

function ErrorState({ error, onReset, onSample }: { 
  error: ErrorInfo
  onReset: () => void 
  onSample: (filename: string) => void
}) {
  return (
    <main className="error-state">
      <div className="error-content">
        <div className="error-icon">
          <AlertCircle size={40} />
        </div>
        <h2 className="error-title">{error.title}</h2>
        <p className="error-message">{error.message}</p>
        <div className="error-actions">
          <button className="error-button" onClick={onReset}>
            Try another file
          </button>
          <button className="error-button secondary" onClick={() => onSample('sample-signups.csv')}>
            Use sample data
          </button>
        </div>
      </div>
    </main>
  )
}

function HeadlineVerdict({ facts }: { facts: Facts }) {
  const direction = facts.change_pct > 0 ? 'rose' : 'fell'
  const isPositive = facts.change_pct > 0
  const topSegment = facts.top_segments[0]
  
  return (
    <div className={`card verdict-card ${isPositive ? 'positive' : ''}`}>
      <div className="verdict-eyebrow">VERDICT</div>
      <h1 className={`verdict-headline ${isPositive ? 'positive' : ''}`}>
        {facts.metric} {direction} <span className="change-value">{Math.abs(facts.change_pct).toFixed(1)}%</span> in {facts.period}
      </h1>
      {topSegment && (
        <div className="verdict-driver">
          Driven by
          <span className={`driver-chip ${isPositive ? 'positive' : ''}`}>
            {topSegment.value}
          </span>
        </div>
      )}
    </div>
  )
}

function PerformanceBadges({ analysisTime }: { analysisTime: number }) {
  return (
    <div className="performance-badges">
      <div className="perf-badge">
        <Zap size={12} />
        <span>Analyzed in {analysisTime.toFixed(2)}s</span>
      </div>
      <div className="perf-badge">
        <Lock size={12} />
        <span>Data never left your browser</span>
      </div>
    </div>
  )
}

function StatsStrip({ facts }: { facts: Facts }) {
  const isPositive = facts.change_pct > 0
  const fmt = (n: number) => new Intl.NumberFormat('en-US').format(Math.round(n))
  
  return (
    <div className="stat-cards">
      <div className="stat-card">
        <div className="stat-label">Observed</div>
        <div className="stat-value">{fmt(facts.observed)}</div>
      </div>
      <div className="stat-card">
        <div className="stat-label">Baseline</div>
        <div className="stat-value">{fmt(facts.baseline)}</div>
      </div>
      <div className="stat-card">
        <div className="stat-label">Change</div>
        <div className={`stat-value change ${isPositive ? 'positive' : ''}`}>
          {isPositive ? <ArrowUpRight size={20} /> : <ArrowDownRight size={20} />}
          {facts.change_pct > 0 ? '+' : ''}{facts.change_pct}%
        </div>
      </div>
      <div className="stat-card">
        <div className="stat-label">Period</div>
        <div className="stat-value">{facts.period}</div>
      </div>
    </div>
  )
}

function AnnotatedChart({ series, anomaly, windowSize, facts }: { 
  series: PeriodPoint[]
  anomaly: AnomalyResult 
  windowSize: number
  facts: Facts
}) {
  // Safety check
  if (!Array.isArray(series) || series.length === 0) {
    return <div className="card">No chart data available</div>
  }
  
  const anomalyIndex = series.findIndex(p => p.period === anomaly.period)
  const windowStart = Math.max(0, anomalyIndex - windowSize)
  const isPositive = facts.change_pct > 0
  const fmt = (n: number) => new Intl.NumberFormat('en-US').format(Math.round(n))
  
  const chartData = series.map((p, idx) => ({
    period: p.period,
    value: p.value,
    baseline: anomaly.baseline,
    isWindow: idx >= windowStart && idx < anomalyIndex
  }))
  
  // Format period for display (W02 instead of 2026-W02)
  const formatPeriod = (period: string) => {
    const match = period.match(/\d{4}-(W\d+)/)
    return match ? match[1] : period
  }
  
  return (
    <div className="card">
      <div className="chart-card-header">
        <div className="chart-title-group">
          <h2 className="chart-title">Trend</h2>
          <p className="chart-subtitle">
            {anomaly.significant 
              ? `${anomaly.changePct > 0 ? 'Increase' : 'Decrease'} of ${Math.abs(anomaly.changePct).toFixed(1)}% detected in ${anomaly.period}`
              : 'No significant anomaly detected'}
          </p>
        </div>
        {anomaly.significant && (
          <div className={`chart-badge ${isPositive ? 'positive' : ''}`}>
            {formatPeriod(anomaly.period)} · {anomaly.changePct > 0 ? '+' : ''}{anomaly.changePct.toFixed(1)}%
          </div>
        )}
      </div>
      <div className="chart-container" role="img" aria-label={`Line chart showing ${facts.metric} trend over time with anomaly at ${anomaly.period}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 16, right: 48, left: 0, bottom: 8 }}>
            <CartesianGrid 
              strokeDasharray="3 3" 
              stroke="var(--border)" 
              vertical={false}
              strokeOpacity={0.4}
            />
            <XAxis 
              dataKey="period" 
              tick={{ fontSize: 11, fill: 'var(--muted)' }}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              interval="preserveStartEnd"
              tickFormatter={formatPeriod}
            />
            <YAxis 
              tick={{ fontSize: 11, fill: 'var(--muted)' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => v >= 1000 ? `${(v/1000).toFixed(1)}k` : v}
              tickCount={4}
            />
            <Tooltip 
              contentStyle={{ 
                background: 'var(--surface)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                fontSize: '12px',
                padding: '8px 12px'
              }}
              formatter={(v: number) => [fmt(v), 'Value']}
              labelFormatter={(label) => formatPeriod(String(label))}
              labelStyle={{ color: 'var(--muted)', fontSize: '12px' }}
            />
            <ReferenceLine 
              y={anomaly.baseline} 
              stroke="var(--muted)" 
              strokeDasharray="4 4"
              label={{ 
                value: `Baseline ${fmt(anomaly.baseline)}`, 
                position: 'insideTopRight', 
                fill: 'var(--muted)', 
                fontSize: 12 
              }}
            />
            {anomalyIndex > 0 && (
              <ReferenceArea
                x1={chartData[windowStart]?.period}
                x2={chartData[anomalyIndex - 1]?.period}
                fill="#2540c4"
                fillOpacity={0.08}
              />
            )}
            <Line 
              type="monotone" 
              dataKey="value" 
              stroke="#2540c4"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
            {anomalyIndex >= 0 && (
              <ReferenceLine
                x={chartData[anomalyIndex]?.period}
                stroke="#d92d20"
                strokeWidth={0}
                label={{
                  value: formatPeriod(chartData[anomalyIndex]?.period),
                  position: 'top',
                  fill: '#d92d20',
                  fontSize: 11,
                  offset: 10
                }}
              >
                <svg>
                  <circle
                    cx={0}
                    cy={0}
                    r={6}
                    fill="#d92d20"
                    stroke="white"
                    strokeWidth={2}
                  />
                </svg>
              </ReferenceLine>
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function SuspectsList({ contributions, headlineChange }: { contributions: SegmentContribution[]; headlineChange: number }) {
  const topSuspects = contributions.slice(0, 5)
  const isHeadlinePositive = headlineChange > 0
  
  // Determine if segment is a driver (same direction as headline) or offset (opposite)
  const getSegmentType = (segmentChange: number, contributionPct: number) => {
    // Driver if segment moved in same direction as headline
    const isDriver = (headlineChange > 0 && segmentChange > 0) || (headlineChange < 0 && segmentChange < 0)
    return isDriver ? 'driver' : 'offset'
  }
  
  return (
    <div className="card">
      <div className="suspects-header">
        <div className="suspects-title-group">
          <h2 className="suspects-title">Suspects</h2>
          <p className="suspects-subtitle">Segments ranked by contribution to the total change</p>
        </div>
        <div className="suspects-legend">
          <div className="legend-item">
            <div className={`legend-dot driver ${isHeadlinePositive ? 'positive' : ''}`}></div>
            <span>{isHeadlinePositive ? 'Drove the rise' : 'Drove the drop'}</span>
          </div>
          <div className="legend-item">
            <div className={`legend-dot offset ${isHeadlinePositive ? 'positive' : ''}`}></div>
            <span>{isHeadlinePositive ? 'Offset the rise' : 'Offset the drop'}</span>
          </div>
        </div>
      </div>
      <div className="suspects-list">
        {topSuspects.map((suspect, idx) => {
          const segmentType = getSegmentType(suspect.changePct, suspect.contributionPct)
          const isSegmentPositive = suspect.changePct > 0
          
          return (
            <div key={`${suspect.dimension}-${suspect.value}`} className="suspect-row">
              <div className="suspect-top">
                <div className="suspect-rank">{idx + 1}</div>
                <div className="suspect-name">{suspect.value}</div>
                <div className="suspect-contribution">
                  {Math.abs(suspect.contributionPct).toFixed(1)}% of the change
                </div>
              </div>
              <div className="suspect-bar-track">
                <div 
                  className={`suspect-bar-fill ${segmentType} ${isHeadlinePositive ? 'positive' : ''}`}
                  style={{ width: `${Math.min(Math.abs(suspect.contributionPct), 100)}%` }}
                />
              </div>
              <div className="suspect-change">
                <span className={`change-icon ${isSegmentPositive ? 'positive' : ''}`}>
                  {isSegmentPositive ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                </span>
                <span>Segment change: {suspect.changePct > 0 ? '+' : ''}{suspect.changePct.toFixed(1)}%</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function AutopsyReport({ 
  autopsy, 
  source, 
  notice 
}: { 
  autopsy: Autopsy
  source: 'llm' | 'template'
  notice: string | null
}) {
  const [copied, setCopied] = useState(false)
  const [downloaded, setDownloaded] = useState(false)
  
  const copyAsText = () => {
    const text = `METRIC AUTOPSY REPORT

${autopsy.headline}

${autopsy.summary}

Hypotheses to Check:
${autopsy.hypotheses.map((h, i) => `${i + 1}. ${h.title}\n   ${h.reasoning}\n   Confidence: ${h.confidence}`).join('\n\n')}

Next Steps:
${autopsy.next_experiment}

---
Generated by Metric Autopsy | ${source === 'llm' ? 'AI-written' : 'Template-based'}${notice ? ' | ' + notice : ''}
`
    navigator.clipboard?.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  
  const downloadMarkdown = () => {
    const md = `# Metric Autopsy Report

## ${autopsy.headline}

${autopsy.summary}

### Hypotheses to Check

${autopsy.hypotheses.map((h, i) => `${i + 1}. **${h.title}**
   
   ${h.reasoning}
   
   *Confidence: ${h.confidence === 'supported' ? '✓ Supported by data' : '? Needs validation'}*`).join('\n\n')}

### Next Steps

${autopsy.next_experiment}

---

*Generated by Metric Autopsy*  
*Source: ${source === 'llm' ? 'AI-written report' : 'Template-based report'}${notice ? ' - ' + notice : ''}*
`
    const blob = new Blob([md], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `autopsy-${new Date().toISOString().split('T')[0]}.md`
    a.click()
    URL.revokeObjectURL(url)
    setDownloaded(true)
    setTimeout(() => setDownloaded(false), 2000)
  }
  
  const downloadJSON = () => {
    const data = {
      report: autopsy,
      meta: {
        source,
        notice,
        generated: new Date().toISOString(),
        generator: 'Metric Autopsy'
      }
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `autopsy-${new Date().toISOString().split('T')[0]}.json`
    a.click()
    URL.revokeObjectURL(url)
  }
  
  // Parse dimension and value from title like "channel · device: Paid Social · Mobile"
  const parseHypothesisTitle = (title: string) => {
    const match = title.match(/^([^:]+):\s*(.+)$/)
    if (match) {
      return { dimension: match[1], value: match[2] }
    }
    return { dimension: null, value: title }
  }
  
  return (
    <div className="card">
      <div className="report-header">
        <h2 className="report-title">Report</h2>
        <div className="report-actions-group">
          <div className={`source-badge-pill ${source}`} title={source === 'template' ? notice || undefined : undefined}>
            {source === 'llm' ? (
              <>
                <Sparkles size={12} />
                <span>AI-written</span>
              </>
            ) : (
              <span>Template</span>
            )}
          </div>
          <button 
            className={`report-action-btn ${copied ? 'success' : ''}`}
            onClick={copyAsText} 
            aria-label="Copy report as plain text"
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            <span>{copied ? 'Copied!' : 'Copy'}</span>
          </button>
          <button 
            className={`report-action-btn ${downloaded ? 'success' : ''}`}
            onClick={downloadMarkdown}
            aria-label="Download report as Markdown"
          >
            {downloaded ? <Check size={16} /> : <Download size={16} />}
            <span>{downloaded ? 'Downloaded!' : 'Download MD'}</span>
          </button>
          <button 
            className="report-action-btn" 
            onClick={downloadJSON}
            aria-label="Export report as JSON"
          >
            <FileJson size={16} />
            <span>JSON</span>
          </button>
        </div>
      </div>
      
      <div className="report-summary">{autopsy.summary}</div>
      
      {notice && source === 'template' && (
        <div className="report-notice">{notice}</div>
      )}
      
      <h3 className="hypotheses-title">Hypotheses to check</h3>
      
      <div className="hypotheses-callout">
        <Info size={16} style={{ flexShrink: 0, marginTop: 2 }} />
        <div>
          This analysis shows <strong>where</strong> the change happened, not <strong>why</strong>. 
          Treat these as hypotheses to investigate, not proof of causation.
        </div>
      </div>
      
      <div className="hypotheses-list">
        {autopsy.hypotheses.map((hypothesis, idx) => {
          const { dimension, value } = parseHypothesisTitle(hypothesis.title)
          
          return (
            <div key={idx} className="hypothesis-card">
              <div className="hypothesis-header">
                <div className="hypothesis-title-group">
                  {dimension && <div className="hypothesis-dimension">{dimension}</div>}
                  <div className="hypothesis-title-text">{value}</div>
                </div>
                <div className={`confidence-badge ${hypothesis.confidence}`}>
                  {hypothesis.confidence === 'supported' ? 'Supported by data' : 'Needs validation'}
                </div>
              </div>
              <div className="hypothesis-reasoning">{hypothesis.reasoning}</div>
            </div>
          )
        })}
      </div>
      
      <div className="next-steps-section">
        <h3 className="next-steps-title">Next steps</h3>
        <p className="next-steps-text">{autopsy.next_experiment}</p>
      </div>
    </div>
  )
}

function ResultsView({ analysis, onReset }: { analysis: AnalysisState; onReset: () => void }) {
  return (
    <main className="results-view">
      <div className="results-top-bar">
        <button className="back-button" onClick={onReset} aria-label="Start new analysis">
          <ArrowLeft size={16} />
          <span>New analysis</span>
        </button>
        <PerformanceBadges analysisTime={analysis.analysisTime} />
      </div>
      
      <HeadlineVerdict facts={analysis.facts} />
      <StatsStrip facts={analysis.facts} />
      <AnnotatedChart 
        series={analysis.series} 
        anomaly={analysis.anomaly}
        windowSize={analysis.windowSize}
        facts={analysis.facts}
      />
      <SuspectsList 
        contributions={analysis.contributions}
        headlineChange={analysis.facts.change_pct}
      />
      <AutopsyReport 
        autopsy={analysis.autopsy}
        source={analysis.reportSource}
        notice={analysis.reportNotice}
      />
    </main>
  )
}

// ============================================================================
// Main Page
// ============================================================================

export default function Page() {
  const [csvText, setCsvText] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [analysis, setAnalysis] = useState<AnalysisState | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingStage, setLoadingStage] = useState('')
  const [loadingStart, setLoadingStart] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<ErrorInfo | null>(null)

  // Elapsed timer
  useEffect(() => {
    if (!loading) return
    const interval = setInterval(() => {
      setElapsed((Date.now() - loadingStart) / 1000)
    }, 100)
    return () => clearInterval(interval)
  }, [loading, loadingStart])

  const loadSample = async (filename: string = 'sample-signups.csv') => {
    const response = await fetch(`/${filename}`)
    const text = await response.text()
    setCsvText(text)
    setFileName(filename)
  }

  const loadFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    
    const reader = new FileReader()
    reader.onload = (ev) => {
      const text = ev.target?.result as string
      setCsvText(text)
      setFileName(file.name)
    }
    reader.readAsText(file)
  }

  const runAnalysis = async () => {
    if (!csvText) return
    
    setLoading(true)
    setLoadingStart(Date.now())
    setError(null)
    
    const startTime = Date.now()

    try {
      // Parse
      setLoadingStage('Parsing CSV...')
      const parsed = parseCsv(csvText)
      
      if (parsed.errors.length > 0) {
        const firstError = parsed.errors[0]
        throw new Error(firstError.message)
      }
      
      if (parsed.rows.length === 0) {
        throw new Error('No data rows found in CSV')
      }
      
      // Detect schema
      setLoadingStage('Detecting schema...')
      const schema = detectSchema(parsed.rows)
      
      if (!schema.dateColumn) {
        setError({
          title: 'Missing date column',
          message: 'Your CSV needs a column with dates. Supported formats: YYYY-MM-DD, ISO week (2026-W38), MM/DD/YYYY.',
          action: 'Try adding a date column'
        })
        setLoading(false)
        return
      }
      
      if (schema.metricColumns.length === 0) {
        setError({
          title: 'No numeric columns found',
          message: 'Add at least one column with numeric values to analyze.',
          action: 'Try adding a metric column'
        })
        setLoading(false)
        return
      }
      
      const metric = schema.metricColumns[0]
      const windowSize = 6
      
      // Aggregate
      setLoadingStage('Finding anomalies...')
      const series = aggregateByPeriod(parsed.rows, schema, metric)
      
      if (series.length < 8) {
        setError({
          title: 'Too few data points',
          message: `Found only ${series.length} periods. Need at least 8 periods for reliable anomaly detection.`,
          action: 'Try a longer date range'
        })
        setLoading(false)
        return
      }
      
      const anomaly = findAnomaly(series, { windowSize })
      
      // Decompose
      setLoadingStage('Analyzing segments...')
      let contributions: SegmentContribution[] = []
      
      if (schema.segmentColumns.length >= 2) {
        const result = decomposeTwo({
          rows: parsed.rows,
          schema,
          metric,
          dimension1: schema.segmentColumns[0],
          dimension2: schema.segmentColumns[1],
          anomalyPeriod: anomaly.period,
          windowSize,
        })
        contributions = result.contributions
      } else if (schema.segmentColumns.length === 1) {
        const result = decompose({
          rows: parsed.rows,
          schema,
          metric,
          dimension: schema.segmentColumns[0],
          anomalyPeriod: anomaly.period,
          windowSize,
        })
        contributions = result.contributions
      }
      
      // Build facts
      const facts = buildFacts({
        rows: parsed.rows,
        metric,
        anomaly,
        contributions: contributions.slice(0, 5),
        missingPct: parsed.missingPct,
      })
      
      // Generate autopsy
      setLoadingStage('Writing report...')
      let autopsy: Autopsy
      let reportSource: 'llm' | 'template' = 'template'
      let reportNotice: string | null = null

      try {
        const response = await narrateFromBackend(facts)
        autopsy = response.autopsy
        reportSource = response.source
        reportNotice = response.notice || null
      } catch (err) {
        autopsy = templateAutopsy(facts)
        reportSource = 'template'
        reportNotice = 'AI service unavailable - using template report'
      }

      const analysisTime = (Date.now() - startTime) / 1000

      setAnalysis({
        schema,
        metric,
        windowSize,
        series,
        anomaly,
        contributions,
        facts,
        autopsy,
        reportSource,
        reportNotice,
        csvText,
        fileName,
        rows: parsed.rows.length,
        missingPct: parsed.missingPct,
        analysisTime,
      })
    } catch (err) {
      setError({
        title: 'Analysis failed',
        message: (err as Error).message || 'An unexpected error occurred',
        action: 'Try a different file'
      })
    } finally {
      setLoading(false)
    }
  }

  const reset = () => {
    setCsvText(null)
    setFileName('')
    setAnalysis(null)
    setError(null)
  }

  // Auto-run analysis when CSV loaded
  useEffect(() => {
    if (csvText && !analysis && !loading && !error) {
      runAnalysis()
    }
  }, [csvText])

  if (error) {
    return <ErrorState error={error} onReset={reset} onSample={loadSample} />
  }

  if (loading) {
    return <LoadingState stage={loadingStage} elapsed={elapsed} />
  }

  if (analysis) {
    return <ResultsView analysis={analysis} onReset={reset} />
  }

  return <EmptyState onSample={loadSample} onFile={loadFile} loading={loading} />
}
