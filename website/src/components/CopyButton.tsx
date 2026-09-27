import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';

interface CopyButtonProps {
  text: string;
  className?: string;
  label?: string;
}

export const CopyButton: React.FC<CopyButtonProps> = ({ text, className = '', label }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className={`copy-btn ${copied ? 'copied' : ''} ${className}`}
      title="Copy to clipboard"
      aria-label="Copy to clipboard"
      type="button"
    >
      {copied ? (
        <>
          <Check size={14} className="stroke-[2.5]" />
          {label && <span style={{ marginLeft: '4px' }}>Copied!</span>}
        </>
      ) : (
        <>
          <Copy size={14} />
          {label && <span style={{ marginLeft: '4px' }}>{label}</span>}
        </>
      )}
    </button>
  );
};
