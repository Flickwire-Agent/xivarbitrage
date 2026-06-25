import { Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useItemSearch } from "../hooks/api.js";
import type { ItemDetails } from "../lib/xivapi.js";

const SEARCH_DEBOUNCE_MS = 250;

export function SearchBox() {
  const [, navigate] = useLocation();
  const [query, setQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: results, error, isFetching, refetch } = useItemSearch(searchQuery);
  const normalizedQuery = query.trim();

  useEffect(() => {
    setSelectedIndex(-1);
    if (!normalizedQuery) {
      setSearchQuery("");
      return undefined;
    }

    if (normalizedQuery.length < 2) {
      setSearchQuery("");
      return undefined;
    }

    const timeoutId = globalThis.setTimeout(
      () => setSearchQuery(normalizedQuery),
      SEARCH_DEBOUNCE_MS,
    );
    return () => globalThis.clearTimeout(timeoutId);
  }, [normalizedQuery]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function selectItem(item: ItemDetails) {
    navigate(`/items/${item.id}`);
    setQuery("");
    setSearchQuery("");
    setIsOpen(false);
    inputRef.current?.blur();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    const items = searchQuery === query.trim() && !isFetching && !error ? (results ?? []) : [];
    if (!isOpen || items.length === 0) {
      if (e.key === "Escape") {
        inputRef.current?.blur();
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setSelectedIndex((prev) => (prev < items.length - 1 ? prev + 1 : 0));
        break;
      case "ArrowUp":
        e.preventDefault();
        setSelectedIndex((prev) => (prev > 0 ? prev - 1 : items.length - 1));
        break;
      case "Enter":
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < items.length) {
          const item = items[selectedIndex]!;
          selectItem(item);
        }
        break;
      case "Escape":
        setIsOpen(false);
        break;
    }
  }

  const listboxId = "search-listbox";
  const items = results ?? [];
  const showPanel = isOpen && normalizedQuery.length > 0;
  const isWaitingForSearch =
    normalizedQuery.length >= 2 && (searchQuery !== normalizedQuery || isFetching);
  const hasNoResults =
    normalizedQuery.length >= 2 &&
    searchQuery === normalizedQuery &&
    !isFetching &&
    !error &&
    items.length === 0;

  return (
    <div className="searchBox" ref={containerRef}>
      <Search size={16} className="searchIcon" aria-hidden="true" />
      <input
        ref={inputRef}
        type="text"
        placeholder="Search items..."
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(e.target.value.trim().length > 0);
        }}
        onFocus={() => normalizedQuery.length > 0 && setIsOpen(true)}
        onKeyDown={handleKeyDown}
        aria-label="Search items"
        aria-controls={listboxId}
        aria-activedescendant={
          selectedIndex >= 0 && isOpen && items[selectedIndex]
            ? `search-result-${items[selectedIndex].id}`
            : undefined
        }
        aria-expanded={showPanel}
        aria-autocomplete="list"
        autoComplete="off"
        role="combobox"
        spellCheck={false}
      />
      {showPanel ? (
        <div className="searchDropdown" role="listbox" id={listboxId}>
          {normalizedQuery.length < 2 ? (
            <div className="searchMessage">Type at least 2 characters to search items.</div>
          ) : isWaitingForSearch ? (
            <div className="searchMessage" role="status" aria-live="polite">
              Searching items...
            </div>
          ) : error ? (
            <div className="searchMessage searchError" role="alert">
              <span>Search failed. Check your connection and try again.</span>
              <button
                type="button"
                className="searchRetry"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => refetch()}
              >
                Retry
              </button>
            </div>
          ) : hasNoResults ? (
            <div className="searchMessage">No items found for &ldquo;{normalizedQuery}&rdquo;.</div>
          ) : (
            items.map((item, i) => (
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
                  <img
                    src={item.iconUrl}
                    alt=""
                    width="32"
                    height="32"
                    className="searchResultIcon"
                    loading="lazy"
                  />
                ) : null}
                <div className="searchResultInfo">
                  <strong>{item.name}</strong>
                  {item.category ? <span>{item.category}</span> : null}
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
