import { ChangeEvent, InputHTMLAttributes, useEffect, useRef } from "react";
// Listen to the native input event as well as blur-independent keyboard edits.
// React's synthetic change detection for datetime-local differs between Chromium hosts.
export function DateInput({
  onChange,
  onInput,
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      onInput={(e) => {
        onInput?.(e);
        onChange?.(e as unknown as ChangeEvent<HTMLInputElement>);
      }}
    />
  );
}

interface DeferredDateInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onInput"> {
  value: string;
  onCommit: (value: string) => void;
}

export function DeferredDateInput({ value, onCommit, ...props }: DeferredDateInputProps) {
  const input = useRef<HTMLInputElement>(null);
  const savedValue = useRef(value);
  useEffect(() => {
    savedValue.current = value;
    if (input.current && document.activeElement !== input.current) {
      input.current.value = value;
    }
  }, [value]);
  return (
    <input
      {...props}
      ref={input}
      defaultValue={value}
      onBlur={(event) => {
        const field = event.currentTarget;
        if (field.validity.badInput) {
          field.value = savedValue.current;
        } else if (field.value !== savedValue.current) {
          onCommit(field.value);
        }
        props.onBlur?.(event);
      }}
    />
  );
}
