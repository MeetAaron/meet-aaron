import React from "react";
import MeetAaronPrototype from "../../components/MeetAaronPrototype";

export default function AppPage() {
  return React.createElement(
      "main",
          { style: { minHeight: "100vh", padding: "16px", background: "#F6F4EF" } },
              React.createElement(MeetAaronPrototype, null)
                );
                }
                
