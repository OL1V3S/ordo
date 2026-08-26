import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import favicon from "../assets/images/ordo_favicon.svg";
import "../index.css";        
import App from "./App.jsx"; 
import { ThemeProvider } from "../shared/theme/ThemeProvider.jsx";

const link = document.createElement("link");
link.rel = "icon";
link.type = "image/svg+xml";
link.href = favicon;
document.head.appendChild(link);

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>
);
