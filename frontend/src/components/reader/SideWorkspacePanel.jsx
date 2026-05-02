import { useMemo, useState } from 'react'

function buildPaperTitle(fileName) {
  if (!fileName) {
    return '未打开文献'
  }

  return fileName.replace(/\.pdf$/i, '')
}

const infoTabs = [
  { id: 'basic', label: '基本信息' },
  { id: 'references', label: '参考文献' },
  { id: 'citations', label: '引用线索' },
]

function displayValue(value) {
  return value || '未在 PDF 元数据中找到'
}

function InfoPanel({ fileName, metadata }) {
  const [activeTab, setActiveTab] = useState('basic')
  const paperTitle = useMemo(
    () => metadata.title || buildPaperTitle(fileName),
    [fileName, metadata.title],
  )

  return (
    <div className="workspace-panel__content">
      <div className="workspace-tabs">
        {infoTabs.map((tab) => (
          <button
            type="button"
            className={`workspace-tab${activeTab === tab.id ? ' is-active' : ''}`}
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'basic' ? (
        <div className="workspace-card-list">
          <div className="workspace-title-card">
            <h3>{paperTitle}</h3>
            <p>文献摘要：{displayValue(metadata.subject)}</p>
          </div>
          <div className="workspace-info-grid">
            <div>
              <span>DOI</span>
              <p>{displayValue(metadata.doi)}</p>
            </div>
            <div>
              <span>作者</span>
              <p>{displayValue(metadata.author)}</p>
            </div>
            <div>
              <span>关键词</span>
              <p>{displayValue(metadata.keywords)}</p>
            </div>
            <div>
              <span>页数 / 文件大小</span>
              <p>
                {metadata.pageCount || '-'} 页
                {metadata.fileSize ? ` / ${metadata.fileSize}` : ''}
              </p>
            </div>
            <div>
              <span>创建工具</span>
              <p>{displayValue(metadata.creator || metadata.producer)}</p>
            </div>
            <div>
              <span>创建 / 修改日期</span>
              <p>
                {displayValue(
                  [metadata.creationDate, metadata.modificationDate]
                    .filter(Boolean)
                    .join(' / '),
                )}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {activeTab === 'references' ? (
        <div className="workspace-card-list">
          <div className="workspace-list-card">
            <h3>参考文献</h3>
            <p>[1] CNN-based human action recognition review</p>
            <p>[2] Deep neural network optimization methods</p>
            <p>[3] Video feature extraction for activity classification</p>
          </div>
        </div>
      ) : null}

      {activeTab === 'citations' ? (
        <div className="workspace-card-list">
          <div className="workspace-list-card">
            <h3>引用线索</h3>
            <p>这里后续可以接入 Crossref、Semantic Scholar 或 OpenAlex 等数据源。</p>
            <p>当前先保留结构，方便你继续往真实论文阅读流推进。</p>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function NotesPanel() {
  return (
    <div className="workspace-panel__content">
      <div className="workspace-title-card">
        <h3>阅读笔记</h3>
        <p>这里可以沉淀高亮片段、批注内容和你的理解，形成更顺手的阅读轨迹。</p>
      </div>
      <textarea className="workspace-textarea" placeholder="记录你的理解、方法拆解或实验疑问..." />
    </div>
  )
}

function AskPanel({ selectionCard }) {
  return (
    <div className="workspace-panel__content">
      <div className="workspace-title-card">
        <h3>边读边问</h3>
        <p>把当前选中的句子延展成问题、追问和方法理解，让阅读更像一次连续推演。</p>
      </div>
      <div className="workspace-list-card">
        <span>当前上下文</span>
        <p>{selectionCard.text || '先在论文里选中一段英文内容。'}</p>
      </div>
      <textarea
        className="workspace-textarea"
        placeholder="例如：这句话在方法里起什么作用？作者为什么要这样设计？"
      />
    </div>
  )
}

function FullTranslatePanel() {
  return (
    <div className="workspace-panel__content">
      <div className="workspace-title-card">
        <h3>全文翻译</h3>
        <p>这里后续可以放整篇论文的连续译文、分段同步和对照阅读能力。</p>
      </div>
      <div className="workspace-list-card">
        <p>当前先保留入口和面板结构，下一步我们可以把它接成真正的全文翻译工作区。</p>
      </div>
    </div>
  )
}

export function SideWorkspacePanel({
  activePanel,
  fileName,
  metadata,
  selectionCard,
  width,
}) {
  const isCollapsed = !activePanel

  return (
    <aside className={`workspace-panel${isCollapsed ? ' is-collapsed' : ''}`} style={{ width: isCollapsed ? 0 : width }}>
      {activePanel === 'info' ? <InfoPanel fileName={fileName} metadata={metadata} /> : null}
      {activePanel === 'notes' ? <NotesPanel /> : null}
      {activePanel === 'ask' ? <AskPanel selectionCard={selectionCard} /> : null}
      {activePanel === 'words' ? <FullTranslatePanel /> : null}
    </aside>
  )
}
