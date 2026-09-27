// Minimal, safe Markdown for AI reports: headings, rules, nested lists, paragraphs,
// **bold**, *italic*, `code`, [links](https://...) and bare https:// URLs.
// Builds React elements (no innerHTML), so model output can never inject markup.
import './Markdown.css'

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s)`>]+|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g

export function Inline({ text }) {
  return String(text).split(INLINE).filter(Boolean).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) return <strong key={i}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`')) {
      const inner = part.slice(1, -1)
      return /^https?:\/\//.test(inner) ? <a key={i} href={inner} target="_blank" rel="noreferrer">{inner}</a> : <code key={i}>{inner}</code>
    }
    const link = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/)
    if (link) return <a key={i} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>
    if (/^https?:\/\//.test(part)) return <a key={i} href={part} target="_blank" rel="noreferrer">{part}</a>
    if ((part.startsWith('*') && part.endsWith('*') && part.length > 2) || (part.startsWith('_') && part.endsWith('_') && part.length > 2)) return <em key={i}>{part.slice(1, -1)}</em>
    return part
  })
}

// Turn list lines (with indentation) into a nested tree.
function buildList(items) {
  const root = {children: []}, stack = [{indent: -1, node: root}]
  for (const item of items) {
    while (stack.length > 1 && item.indent <= stack[stack.length - 1].indent) stack.pop()
    const node = {...item, children: []}
    stack[stack.length - 1].node.children.push(node)
    stack.push({indent: item.indent, node})
  }
  return root.children
}

function List({ items }) {
  const ordered = items[0]?.ordered
  const Tag = ordered ? 'ol' : 'ul'
  return <Tag>{items.map((item, i) => <li key={i}><Inline text={item.text} />{item.children.length > 0 && <List items={item.children} />}</li>)}</Tag>
}

export default function Markdown({ text }) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n')
  const blocks = []
  let paragraph = [], list = []
  const flushParagraph = () => { if (paragraph.length) { blocks.push({type: 'p', text: paragraph.join(' ')}); paragraph = [] } }
  const flushList = () => { if (list.length) { blocks.push({type: 'list', items: buildList(list)}); list = [] } }
  for (const raw of lines) {
    const line = raw.replace(/\t/g, '    ')
    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/)
    const item = line.match(/^(\s*)([*+-]|\d+[.)])\s+(.*)$/)
    if (!line.trim()) { flushParagraph(); flushList(); continue }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) { flushParagraph(); flushList(); blocks.push({type: 'hr'}); continue }
    if (heading) { flushParagraph(); flushList(); blocks.push({type: 'h', level: heading[1].length, text: heading[2].replace(/#+\s*$/, '')}); continue }
    if (item) { flushParagraph(); list.push({indent: item[1].length, ordered: /\d/.test(item[2]), text: item[3]}); continue }
    if (list.length && /^\s{2,}\S/.test(line)) { list[list.length - 1].text += ' ' + line.trim(); continue }
    flushList(); paragraph.push(line.trim())
  }
  flushParagraph(); flushList()
  return <div className="markdown">{blocks.map((block, i) => {
    if (block.type === 'hr') return <hr key={i} />
    if (block.type === 'h') { const Tag = block.level <= 3 ? 'h3' : 'h4'; return <Tag key={i}><Inline text={block.text} /></Tag> }
    if (block.type === 'list') return <List key={i} items={block.items} />
    return <p key={i}><Inline text={block.text} /></p>
  })}</div>
}
