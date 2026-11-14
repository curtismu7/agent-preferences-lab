import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import { visible } from "./safeText.js";
// Rule 24: JsonView uses the lab's visible() guard for strings in both modes.
window.__safeTextVisible = visible;
import "./standalone-ui.css";
import "./tokens.css";
import "./top-menu/top-menu.css";
import "./app.css";

// Mirror the OS colour scheme into data-theme (tokens.css keys dark mode on it), and follow changes live.
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
const applyTheme = () => { document.documentElement.dataset.theme = darkQuery.matches ? "dark" : "light"; };
applyTheme();
darkQuery.addEventListener("change", applyTheme);

createRoot(document.getElementById("root")).render(<App />);
