import React, { useEffect, useRef, useState } from 'react';

interface TodoInputProps {
  readonly title?: string;
  readonly onSave: (value: string) => void;
  readonly onStop?: () => void;
  readonly className?: string;
  readonly id?: string;
  readonly placeholder?: string;
}

/** Local input/editing state is intentionally not part of either data cache. */
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
    inputRef.current?.focus();
  }, []);

  const stop = () => {
    setValue('');
    onStop?.();
  };

  const save = () => {
    onSave(value.trim());
    stop();
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      save();
    } else if (event.key === 'Escape') {
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
      onChange={(event) => setValue(event.target.value)}
      onBlur={save}
      onKeyDown={handleKeyDown}
    />
  );
};
