import type { ButtonHTMLAttributes } from 'react';

interface DispatchButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  size?: 'xs' | 'sm';
}

export default function DispatchButton({ size = 'sm', onClick, ...props }: DispatchButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`btn btn-${size} btn-ghost gap-1`}
      {...props}
    >
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
        <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
      </svg>
      Dispatch
    </button>
  );
}
