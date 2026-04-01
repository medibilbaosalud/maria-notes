import React, { useMemo } from 'react';
import { AlertTriangle, ArrowRight, Calendar, Clock3, Crosshair, Eye, Layers3, ListChecks, MessageCircle, Sparkles, TrendingUp } from 'lucide-react';
import type { PatientBriefing } from '../services/storage';
import './PatientBriefingCard.css';

type BriefingCardVariant = 'full' | 'compact';

interface StructuredBriefing {
  hilo_terapeutico?: string;
  ultima_sesion?: {
    fecha?: string;
    resumen?: string;
  };
  momento_del_proceso?: string;
  pendientes?: string[];
  patrones_observados?: string[];
  alerta_clinica?: string;
  frase_para_retomar?: string;
  evolucion?: string;
}

interface PatientBriefingCardProps {
  briefing: PatientBriefing;
  variant?: BriefingCardVariant;
  onOpenHistory?: () => void;
  onDismiss?: () => void;
}

const parseStructuredBriefing = (summaryText: string): StructuredBriefing | null => {
  const text = String(summaryText || '').trim();
  if (!text) return null;

  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && (parsed.hilo_terapeutico || parsed.ultima_sesion)) {
      return parsed as StructuredBriefing;
    }
  } catch {
    // Not structured JSON
  }
  return null;
};

const parseLegacyBriefing = (summaryText: string): string[] => {
  return String(summaryText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
};

const formatBriefingDate = (value: string) => {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
};

const getSourceLabel = (sourceKind: PatientBriefing['source_kind']) => {
  if (sourceKind === 'legacy') return 'Importado';
  if (sourceKind === 'mixed') return 'Mixto';
  return 'Sesiones';
};

export const PatientBriefingCard: React.FC<PatientBriefingCardProps> = ({
  briefing,
  variant = 'full',
  onOpenHistory,
  onDismiss
}) => {
  const structured = useMemo(() => parseStructuredBriefing(briefing.summary_text), [briefing.summary_text]);
  const legacyLines = useMemo(() => structured ? null : parseLegacyBriefing(briefing.summary_text), [structured, briefing.summary_text]);

  // Structured briefing (new format)
  if (structured) {
    return (
      <section className={`pbcard pbcard--${variant}`} data-has-alert={Boolean(structured.alerta_clinica) || undefined}>
        {/* Header */}
        <div className="pbcard__header">
          <div className="pbcard__kicker">
            <Sparkles size={13} />
            <span>Preparación clínica</span>
          </div>
          <div className="pbcard__meta">
            <span className="pbcard__pill">
              <Layers3 size={12} />
              {briefing.generated_from_count} {briefing.generated_from_count === 1 ? 'sesión' : 'sesiones'}
            </span>
            <span className="pbcard__pill">
              <Calendar size={12} />
              {getSourceLabel(briefing.source_kind)}
            </span>
          </div>
        </div>

        {/* Hilo terapéutico — the hero */}
        {structured.hilo_terapeutico && (
          <div className="pbcard__hilo">
            <div className="pbcard__hilo-icon">
              <Crosshair size={16} />
            </div>
            <div className="pbcard__hilo-content">
              <span className="pbcard__hilo-label">Hilo del caso</span>
              <p className="pbcard__hilo-text">{structured.hilo_terapeutico}</p>
            </div>
          </div>
        )}

        {/* Main grid */}
        <div className={`pbcard__grid ${variant === 'compact' ? 'pbcard__grid--single' : ''}`}>
          {/* Última sesión */}
          {structured.ultima_sesion?.resumen && (
            <div className="pbcard__cell pbcard__cell--sky">
              <div className="pbcard__cell-header">
                <Clock3 size={14} />
                <span className="pbcard__cell-label">Última sesión</span>
                {structured.ultima_sesion.fecha && (
                  <span className="pbcard__cell-date">{formatBriefingDate(structured.ultima_sesion.fecha)}</span>
                )}
              </div>
              <p className="pbcard__cell-body">{structured.ultima_sesion.resumen}</p>
            </div>
          )}

          {/* Momento del proceso */}
          {structured.momento_del_proceso && (
            <div className="pbcard__cell pbcard__cell--violet">
              <div className="pbcard__cell-header">
                <TrendingUp size={14} />
                <span className="pbcard__cell-label">Momento del proceso</span>
              </div>
              <p className="pbcard__cell-body">{structured.momento_del_proceso}</p>
            </div>
          )}

          {/* Pendientes */}
          {structured.pendientes && structured.pendientes.length > 0 && (
            <div className="pbcard__cell pbcard__cell--amber">
              <div className="pbcard__cell-header">
                <ListChecks size={14} />
                <span className="pbcard__cell-label">Pendientes</span>
              </div>
              <ul className="pbcard__cell-list">
                {structured.pendientes.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Patrones observados */}
          {structured.patrones_observados && structured.patrones_observados.length > 0 && (
            <div className="pbcard__cell pbcard__cell--emerald">
              <div className="pbcard__cell-header">
                <Eye size={14} />
                <span className="pbcard__cell-label">Patrones observados</span>
              </div>
              <ul className="pbcard__cell-list">
                {structured.patrones_observados.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Evolución */}
          {structured.evolucion && (
            <div className="pbcard__cell pbcard__cell--teal">
              <div className="pbcard__cell-header">
                <TrendingUp size={14} />
                <span className="pbcard__cell-label">Evolución</span>
              </div>
              <p className="pbcard__cell-body">{structured.evolucion}</p>
            </div>
          )}
        </div>

        {/* Alerta clínica */}
        {structured.alerta_clinica && (
          <div className="pbcard__alert">
            <AlertTriangle size={15} />
            <p>{structured.alerta_clinica}</p>
          </div>
        )}

        {/* Frase para retomar */}
        {structured.frase_para_retomar && (
          <div className="pbcard__retomar">
            <MessageCircle size={14} />
            <p>{structured.frase_para_retomar}</p>
          </div>
        )}

        {/* Footer actions */}
        {(onOpenHistory || onDismiss) && (
          <div className="pbcard__actions">
            {onOpenHistory && (
              <button type="button" className="pbcard__action" onClick={onOpenHistory}>
                Ver historial completo
                <ArrowRight size={14} />
              </button>
            )}
            {onDismiss && (
              <button type="button" className="pbcard__action pbcard__action--muted" onClick={onDismiss}>
                Ocultar
              </button>
            )}
          </div>
        )}
      </section>
    );
  }

  // Legacy fallback (plain text briefing)
  return (
    <section className={`pbcard pbcard--${variant} pbcard--legacy`}>
      <div className="pbcard__header">
        <div className="pbcard__kicker">
          <Sparkles size={13} />
          <span>Contexto del caso</span>
        </div>
      </div>
      <div className="pbcard__legacy-body">
        {legacyLines?.map((line, i) => (
          <p key={i}>{line}</p>
        ))}
      </div>
      {(onOpenHistory || onDismiss) && (
        <div className="pbcard__actions">
          {onOpenHistory && (
            <button type="button" className="pbcard__action" onClick={onOpenHistory}>
              Ver historial completo
              <ArrowRight size={14} />
            </button>
          )}
          {onDismiss && (
            <button type="button" className="pbcard__action pbcard__action--muted" onClick={onDismiss}>
              Ocultar
            </button>
          )}
        </div>
      )}
    </section>
  );
};

