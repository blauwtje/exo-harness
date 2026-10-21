import { useMemo } from 'react';
import { BaseEdge, Handle, Position, ReactFlow, getStraightPath } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { STATUS_WORD, Mark } from './parts.jsx';
import { isLive, shortId } from './derive.js';

function AgentNode({ data }) {
  return (
    <div className="flow-node flow-agent" data-waiting={data.job.status === 'waiting'} data-linked={data.linked}>
      <Mark status={data.job.status} label={STATUS_WORD[data.job.status]} />
      <span className="flow-title">{data.job.stage ?? 'agent'}</span>
      <span className="num dim">{shortId(data.job.id)}</span>
      <Handle type="source" position={Position.Right} isConnectable={false} />
    </div>
  );
}

function CardNode({ data }) {
  return (
    <div className="flow-node flow-card" data-linked={data.linked}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <span className="flow-title">{data.card.title}</span>
      <span className="dim">{data.card.lane}</span>
    </div>
  );
}

function StrutEdge({ id, sourceX, sourceY, targetX, targetY, data }) {
  const [path, mx, my] = getStraightPath({ sourceX, sourceY, targetX, targetY });
  return (
    <g className="strut" data-hot={data?.hot} data-linked={data?.linked}>
      <BaseEdge id={id} path={path} />
      <rect x={sourceX - 1} y={sourceY - 6} width="3" height="12" className="strut-foot" />
      <rect x={targetX - 2} y={targetY - 6} width="3" height="12" className="strut-foot" />
      <rect x={mx - 3} y={my - 3} width="6" height="6" transform={`rotate(45 ${mx} ${my})`} className="strut-pin" />
    </g>
  );
}

const nodeTypes = { agent: AgentNode, card: CardNode };
const edgeTypes = { strut: StrutEdge };

export default function CrewPanel({ state, project, focusCard, open }) {
  const { nodes, edges, count } = useMemo(() => {
    const cards = new Map(state.cards.filter((c) => c.projectKey === project.key).map((c) => [c.id, c]));
    const jobs = state.jobs.filter((j) => isLive(j) && cards.has(j.cardId));
    const ns = [];
    const es = [];
    const placed = new Map();
    jobs.forEach((job, i) => {
      const card = cards.get(job.cardId);
      ns.push({ id: `a:${job.id}`, type: 'agent', position: { x: 0, y: i * 80 }, data: { job, linked: card.id === focusCard }, draggable: false });
      if (!placed.has(card.id)) {
        placed.set(card.id, `c:${card.id}`);
        ns.push({ id: `c:${card.id}`, type: 'card', position: { x: 184, y: i * 80 }, data: { card, linked: card.id === focusCard }, draggable: false });
      }
      es.push({ id: `e:${job.id}`, source: `a:${job.id}`, target: placed.get(card.id), type: 'strut', data: { hot: job.status === 'waiting', linked: card.id === focusCard } });
    });
    return { nodes: ns, edges: es, count: jobs.length };
  }, [state, project.key, focusCard]);

  return (
    <aside className="crew" aria-labelledby="crew-h" id="crew-panel" data-open={open}>
      <h2 id="crew-h" className="section-h">Crew <span className="count num">{count}</span></h2>
      <div className="crew-frame">
        {count === 0 ? <p className="lane-empty crew-empty">No agents running. Struts appear here when a job starts.</p> : null}
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} defaultViewport={{ x: 0, y: 12, zoom: 1 }} minZoom={1} maxZoom={1}
          nodesDraggable={false} nodesConnectable={false} elementsSelectable={false} panOnDrag={count > 4} zoomOnScroll={false}
          zoomOnDoubleClick={false} zoomOnPinch={false} preventScrolling={false} proOptions={{ hideAttribution: true }} aria-label="Agents linked to their cards" />
      </div>
    </aside>
  );
}
