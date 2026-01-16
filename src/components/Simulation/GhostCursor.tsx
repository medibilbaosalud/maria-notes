import React from 'react';
import { motion } from 'framer-motion';

interface GhostCursorProps {
    x: number;
    y: number;
}

export const GhostCursor: React.FC<GhostCursorProps> = ({ x, y }) => {
    return (
        <motion.div
            initial={{ opacity: 0, x, y }}
            animate={{ opacity: 1, x, y }}
            transition={{
                type: "spring",
                damping: 25,
                stiffness: 200,
                mass: 0.5
            }}
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                pointerEvents: 'none',
                zIndex: 10000,
                filter: 'drop-shadow(0px 4px 6px rgba(0,0,0,0.3))'
            }}
        >
            {/* Simple Cursor SVG */}
            <svg
                width="32"
                height="32"
                viewBox="0 0 32 32"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
            >
                <path
                    d="M5.65376 2.58197C5.16668 1.4883 6.6417 0.590806 7.51138 1.4503L22.4276 16.1256C23.1119 16.7997 22.8123 18.0076 21.9026 18.2575L14.7709 20.2185C14.4475 20.3074 14.1687 20.5297 14.0202 20.819L10.3773 27.9103C9.91681 28.8066 8.59806 28.6923 8.35515 27.7242L5.65376 2.58197Z"
                    fill="white"
                    stroke="black"
                    strokeWidth="1.5"
                    strokeLinejoin="round"
                />
            </svg>

            {/* Click Ripple Effect (Optional refinement for later) */}
        </motion.div>
    );
};
