import { useId } from "react";

interface SelectFieldProps {
  label: string;
  value: string;
  options: string[];
  optionLabels?: Record<string, string>;
  onChange: (value: string) => void;
}

export function SelectField({
  label,
  value,
  options,
  optionLabels = {},
  onChange,
}: SelectFieldProps) {
  const generatedId = useId();
  const selectId = `select-${label.replace(/\s+/g, "-").toLowerCase()}-${generatedId}`;

  return (
    <div className="selectField">
      <label htmlFor={selectId}>{label}</label>
      <select id={selectId} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Any</option>
        {options.map((option) => (
          <option value={option} key={option}>
            {optionLabels[option] ?? option}
          </option>
        ))}
      </select>
    </div>
  );
}
