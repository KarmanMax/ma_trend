import React from "react";
import ReactDOM from "react-dom/client";
import { WyckoffApp } from "./WyckoffApp";
import "../styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WyckoffApp />
  </React.StrictMode>
);
