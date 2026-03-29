import React from 'react';
import { Calendar, Clock3, Layers3, Sparkles } from 'lucide-react';
import type { PatientBriefing } from '../services/storage';
import './PatientBriefingCard.css';

type BriefingSectionKey = 'focus' | 'recent' | 'drivers' | 'plan' | 'watch';

type BriefingCardVariant = 'full' | 'compact';

interface BriefingSection {
  key: BriefingSectionKey;
  title: string;
  eyebrow: string;
  tone: 'emerald' | 'sky' | 'amber' | 'violet' | 'rose';
  body: string;
}

interface PatientBriefingCardProps {
  briefing: PatientBriefing;
  variant?: BriefingCardVariant;
  kicker?: string;
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
}

const SECTION_CONFIG: Record<BriefingSectionKey, Omit<BriefingSection, 'body'>> = {
  focus: {
    key: 'focus',
    title: 'Foco actual',
    eyebrow: 'Lo que mas importa hoy',
    tone: 'emerald'
  },
  recent: {
    key: 'recent',
    title: 'Ultima sesion',
    eyebrow: 'Trabajo mas reciente',
    tone: 'sky'
  },
  drivers: {
    key: 'drivers',
    title: 'Mantenedores',
    eyebrow: 'Factores que sostienen el malestar',
    tone: 'amber'
  },
  plan: {
    key: 'plan',
    title: 'Proxima sesion',
    eyebrow: 'Pendientes y acuerdos',
    tone: 'violet'
  },
  watch: {
    key: 'watch',
    title: 'Recordatorio clinico',
    eyebrow: 'Conviene no perder esto de vista',
    tone: 'rose'
  }
};

const SECTION_ORDER: BriefingSectionKey[] = ['focus', 'recent', 'drivers', 'plan', 'watch'];

const SECTION_LABELS: Record<BriefingSectionKey, string[]> = {
  focus: ['foco actual', 'motivo actual', 'motivo principal', 'foco principal'],
  recent: ['ultima sesion', 'sesion mas reciente', 'ultima consulta', 'trabajo reciente'],
  drivers: ['mantenedores', 'factores mantenedores', 'areas afectadas', 'factores relevantes'],
  plan: ['proxima sesion', 'tareas', 'acuerdos', 'objetivos', 'pendientes'],
  watch: ['recordatorio clinico', 'recordatorios clinicos', 'alerta clinica', 'sensibles']
};

const normalizeLabel = (value: string) => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9\s]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const resolveSectionKey = (label: string): BriefingSectionKey | null => {
  const normalized = normalizeLabel(label);
  return SECTION_ORDER.find((key) => SECTION_LABELS[key].includes(normalized)) || null;
};

const splitBriefingLines = (summaryText: string) => String(summaryText || '')
  .replace(/\r/g, '')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean);

const parseBriefingSections = (summaryText: string): { sections: BriefingSection[]; extras: string[] } => {
  const rawLines = splitBriefingLines(summaryText);
  const foundSections = new Map<BriefingSectionKey, string>();
  const extras: string[] = [];

  rawLines.forEach((line) => {
    const match = line.match(/^([^:]+):\s*(.+)$/);
    if (!match) {
      extras.push(line);
      return;
    }

    const sectionKey = resolveSectionKey(match[1]);
    if (!sectionKey) {
      extras.push(line);
      return;
    }

    const body = match[2].trim();
    if (!body || foundSections.has(sectionKey)) return;
    foundSections.set(sectionKey, body);
  });

  if (foundSections.size === 0 && rawLines.length > 0) {
    rawLines.slice(0, SECTION_ORDER.length).forEach((line, index) => {
      const sectionKey = SECTION_ORDER[index];
      if (sectionKey) {
        foundSections.set(sectionKey, line);
      }
    });
    rawLines.slice(SECTION_ORDER.length).forEach((line) => extras.push(line));
  }

  const sections = SECTION_ORDER
    .map((key) => {
      const body = foundSections.get(key);
      if (!body) return null;
      return {
        ...SECTION_CONFIG[key],
        body
      };
    })
    .filter((section): section is BriefingSection => Boolean(section));

  return { sections, extras };
};

const formatDate = (value: string) => {
  if (!value) return 'Sin fecha';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Sin fecha';
  return parsed.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
};

const getSourceKindLabel = (sourceKind: PatientBriefing['source_kind']) => {
  if (sourceKind === 'legacy') return 'Contexto importado';
  if (sourceKind === 'mixed') return 'Contexto mixto';
  return 'Sesiones recientes';
};

export const PatientBriefingCard: React.FC<PatientBriefingCardProps> = ({
  briefing,
  variant = 'full',
  kicker = 'Preparacion clinica',
  title = 'Antes de la sesion',
  subtitle = 'Contexto accionable generado con IA para retomar el caso sin releer toda la historia.',
  actions
}) => {
  const { sections, extras } = parseBriefingSections(briefing.summary_text);
  const focusSection = sections.find((section) => section.key === 'focus') || sections[0] || null;
  const secondarySections = sections.filter((section) => section !== focusSection);

  return (
    <section className={`patient-briefing-card patient-briefing-card--${variant}`}>
      <div className="patient-briefing-card__header">
        <div className="patient-briefing-card__headline">
          <div className="patient-briefing-card__kicker">
            <Sparkles size={14} />
            <span>{kicker}</span>
          </div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
        <div className="patient-briefing-card__meta">
          <span className="patient-briefing-card__badge">
            <Clock3 size={14} />
            <span>{briefing.generated_from_count} sesiones</span>
          </span>
          <span className="patient-briefing-card__badge">
            <Calendar size={14} />
            <span>{formatDate(briefing.latest_consultation_at)}</span>
          </span>
          <span className="patient-briefing-card__badge">
            <Layers3 size={14} />
            <span>{getSourceKindLabel(briefing.source_kind)}</span>
          </span>
        </div>
      </div>

      {focusSection && (
        <div className={`patient-briefing-card__focus patient-briefing-card__focus--${focusSection.tone}`}>
          <span className="patient-briefing-card__focus-label">{focusSection.title}</span>
          <p>{focusSection.body}</p>
        </div>
      )}

      {secondarySections.length > 0 && (
        <div className="patient-briefing-card__grid">
          {secondarySections.map((section) => (
            <article
              key={section.key}
              className={`patient-briefing-card__section patient-briefing-card__section--${section.tone}`}
            >
              <span className="patient-briefing-card__section-eyebrow">{section.eyebrow}</span>
              <h3>{section.title}</h3>
              <p>{section.body}</p>
            </article>
          ))}
        </div>
      )}

      {extras.length > 0 && (
        <div className="patient-briefing-card__extras">
          <span className="patient-briefing-card__extras-label">Puntos clave</span>
          <ul>
            {extras.map((line) => <li key={line}>{line}</li>)}
          </ul>
        </div>
      )}

      {actions ? <div className="patient-briefing-card__actions">{actions}</div> : null}
    </section>
  );
};

