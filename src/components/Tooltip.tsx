import React, { useState, useRef } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
    content: string;
    children: React.ReactNode;
    enabled?: boolean;
}

export const Tooltip: React.FC<TooltipProps> = ({ content, children, enabled = true }) => {
    const [visible, setVisible] = useState(false);
    const [position, setPosition] = useState({ x: 0, y: 0 });
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    const handleMouseEnter = (e: React.MouseEvent) => {
        if (!enabled) return;
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setPosition({ x: rect.left + rect.width / 2, y: rect.bottom + 10 });

        timeoutRef.current = setTimeout(() => {
            setVisible(true);
        }, 400);
    };

    const handleMouseLeave = () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setVisible(false);
    };

    const tooltipElement = visible ? (
        <div style={{
            position: 'fixed',
            top: position.y,
            left: position.x,
            transform: 'translateX(-50%)',
            background: 'rgba(0, 0, 0, 0.9)',
            border: '1px solid var(--color-neon-cyan)',
            borderRadius: '4px',
            padding: '8px 12px',
            color: '#fff',
            fontSize: '0.8rem',
            zIndex: 99999, /* Very high z-index */
            pointerEvents: 'none',
            boxShadow: '0 0 10px rgba(0, 255, 255, 0.3)',
            backdropFilter: 'blur(4px)',
            whiteSpace: 'nowrap',
            opacity: visible ? 1 : 0,
            transition: 'opacity 0.2s',
        }}>
            {content}
        </div>
    ) : null;

    return (
        <div
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            style={{ position: 'relative', display: 'inline-block' }}
        >
            {children}
            {visible && createPortal(tooltipElement, document.body)}
        </div>
    );
};
