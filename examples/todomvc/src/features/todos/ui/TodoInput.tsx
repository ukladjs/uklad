import React, { useEffect, useRef, useState } from 'react';

interface TodoInputProps {
  title?: string;
  onSave: (value: string) => void;
  onStop?: () => void;
  className?: string;
  id?: string;
  placeholder?: string;
}

/** Local editing state only — nothing here reaches the runtime. */
export const TodoInput: React.FC<TodoInputProps> = ({
  title = '',
  onSave,
  onStop,
  className = '',
  id,
  placeholder,
}) => {
  const [value, setValue] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const stop = () => {
    setValue('');
    if (onStop) onStop();
  };

  const save = () => {
    const trimmed = value.trim();
    onSave(trimmed);
    stop();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      save();
    } else if (e.key === 'Escape') {
      stop();
    }
  };

  return (
    <input
      ref={inputRef}
      type="text"
      className={className}
      id={id}
      placeholder={placeholder}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={handleKeyDown}
    />
  );
};
