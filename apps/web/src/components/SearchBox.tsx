import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

interface SearchResult {
  id: number;
  name: string;
  iconUrl?: string;
  category?: string;
}

export function SearchBox() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/items/search?q=${encodeURIComponent(query)}`);
        if (res.ok) {
          const data = await res.json();
          setResults(data.results ?? []);
          setIsOpen(true);
          setSelectedIndex(-1);
        }
      } catch {
        // ignore
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function selectItem(item: SearchResult) {
    navigate(`/items/${item.id}`);
    setQuery("");
    setResults([]);
    setIsOpen(false);
    inputRef.current?.blur();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!isOpen || results.length === 0) {
      if (e.key === "Escape") {
        inputRef.current?.blur();
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
        break;
      case "Enter":
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < results.length) {
          const item = results[selectedIndex]!;
          selectItem(item);
        }
        break;
      case "Escape":
        setIsOpen(false);
        break;
    }
  }

  const listboxId = "search-listbox";

  return (
    <div className="searchBox" ref={containerRef}>
      <Search size={16} className="searchIcon" aria-hidden="true" />
      <input
        ref={inputRef}
        type="text"
        placeholder="Search items..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => results.length > 0 && setIsOpen(true)}
        onKeyDown={handleKeyDown}
        aria-label="Search items"
        aria-controls={listboxId}
        aria-activedescendant={
          selectedIndex >= 0 && isOpen && results[selectedIndex]
            ? `search-result-${results[selectedIndex].id}`
            : undefined
        }
        aria-expanded={isOpen && results.length > 0}
        aria-autocomplete="list"
        autoComplete="off"
        role="combobox"
        spellCheck={false}
      />
      {isOpen && results.length > 0 ? (
        <div className="searchDropdown" role="listbox" id={listboxId}>
          {results.map((item, i) => (
            <div
              key={item.id}
              id={`search-result-${item.id}`}
              className={`searchResult${i === selectedIndex ? " active" : ""}`}
              role="option"
              aria-selected={i === selectedIndex}
              onClick={() => selectItem(item)}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              {item.iconUrl ? (
                <img src={item.iconUrl} alt="" className="searchResultIcon" loading="lazy" />
              ) : null}
              <div className="searchResultInfo">
                <strong>{item.name}</strong>
                {item.category ? <span>{item.category}</span> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
