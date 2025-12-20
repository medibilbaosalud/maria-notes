import React from 'react';
import { motion } from 'framer-motion';
import logo from '../assets/logo.png';

export const MBSLogo: React.FC<{ size?: number }> = ({ size = 48 }) => {
    return (
        <motion.div
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
            <img
                src={logo}
                alt="MediBilbao Salud Logo"
                style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain'
                }}
            />
        </motion.div>
    );
};
