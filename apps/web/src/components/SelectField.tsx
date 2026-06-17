interface SelectFieldProps {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}

let selectIdCounter = 0;

export function SelectField({ label, value, options, onChange }: SelectFieldProps) {
  const selectId = `select-${label.replace(/\s+/g, "-").toLowerCase()}-${++selectIdCounter}`;

  return (
    <div className="selectField">
      <label htmlFor={selectId}>{label}</label>
      <select id={selectId} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Any</option>
        {options.map((option) => (
          <option value={option} key={option}>
            {option}
          </option>
        ))}
      </select>
    </div>
  );
}
