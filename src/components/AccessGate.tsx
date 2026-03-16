import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { LockKeyhole, ShieldCheck, AlertCircle } from 'lucide-react';
import { MBSLogo } from './MBSLogo';
import { motionTransitions } from '../features/ui/motion-tokens';

interface AccessGateProps {
    onUnlocked: () => void;
}

type AccessState = 'checking' | 'locked' | 'submitting' | 'error';

export const AccessGate = ({ onUnlocked }: AccessGateProps) => {
    const [password, setPassword] = useState('');
    const [state, setState] = useState<AccessState>('checking');
    const [message, setMessage] = useState('');

    useEffect(() => {
        let cancelled = false;
        const bootstrap = async () => {
            try {
                const response = await fetch('/api/access', {
                    method: 'GET',
                    credentials: 'include'
                });
                const payload = await response.json();
                if (cancelled) return;
                if (payload?.unlocked || payload?.required === false) {
                    onUnlocked();
                    return;
                }
                setState('locked');
            } catch (error) {
                if (cancelled) return;
                setState('error');
                setMessage(error instanceof Error ? error.message : 'No se pudo validar el acceso');
            }
        };
        void bootstrap();
        return () => {
            cancelled = true;
        };
    }, [onUnlocked]);

    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!password.trim()) return;
        setState('submitting');
        setMessage('');
        try {
            const response = await fetch('/api/access', {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ password })
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.unlocked) {
                throw new Error(payload?.error === 'invalid_password' ? 'Contrasena incorrecta' : 'No se pudo abrir la app');
            }
            onUnlocked();
        } catch (error) {
            setState('error');
            setMessage(error instanceof Error ? error.message : 'No se pudo validar el acceso');
        }
    };

    if (state === 'checking') {
        return (
            <div className="access-gate-screen">
                <div className="access-gate-card access-gate-card-loading">
                    <MBSLogo size={58} />
                    <p>Validando acceso seguro...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="access-gate-screen">
            <motion.div
                className="access-gate-card"
                initial={{ opacity: 0, y: 14, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={motionTransitions.normal}
            >
                <div className="access-gate-brand">
                    <MBSLogo size={58} />
                    <div>
                        <span className="access-gate-eyebrow">Acceso protegido</span>
                        <h1>Maria Notes</h1>
                    </div>
                </div>

                <div className="access-gate-copy">
                    <p>
                        Introduce la contrasena de acceso para entrar en la aplicacion.
                    </p>
                    <div className="access-gate-badges">
                        <span><ShieldCheck size={14} /> Entorno clinico privado</span>
                        <span><LockKeyhole size={14} /> Validacion segura en servidor</span>
                    </div>
                </div>

                <form className="access-gate-form" onSubmit={(event) => void handleSubmit(event)}>
                    <label htmlFor="app-access-password">Contrasena</label>
                    <input
                        id="app-access-password"
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="Introduce la contrasena"
                        autoComplete="current-password"
                    />
                    <button type="submit" disabled={state === 'submitting' || !password.trim()}>
                        {state === 'submitting' ? 'Comprobando...' : 'Entrar'}
                    </button>
                </form>

                <AnimatePresence initial={false}>
                    {message && (
                        <motion.div
                            className="access-gate-feedback"
                            data-ui-state={state === 'error' ? 'error' : 'idle'}
                            initial={{ opacity: 0, y: 6 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            transition={motionTransitions.fast}
                        >
                            <AlertCircle size={16} />
                            <span>{message}</span>
                        </motion.div>
                    )}
                </AnimatePresence>
            </motion.div>
        </div>
    );
};
