"use client";

import { Icon } from "@/components/icons/Icon";
import { useExplainer } from "@/context/ExplainerContext";

export function ExplainerModal() {
  const { explanation, closeExplanation } = useExplainer();
  if (!explanation) return null;

  return (
    <div
      id="explainer-modal"
      className="explainer-overlay visible"
      role="dialog"
      aria-modal="true"
      aria-labelledby="explainer-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) closeExplanation();
      }}
    >
      <div className="explainer-card">
        <div className="explainer-header">
          <div className="explainer-title-group">
            <Icon name="info" size={16} className="explainer-icon" />
            <h4 id="explainer-title">{explanation.title}</h4>
          </div>
          <button className="explainer-close" onClick={closeExplanation} title="Close (Esc)" aria-label="Close" type="button">
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className="explainer-body">
          <div className="explainer-section">
            <div className="explainer-label">What is this?</div>
            <div className="explainer-text">{explanation.whatIs}</div>
          </div>
          <div className="explainer-section">
            <div className="explainer-label">What does it do?</div>
            <div className="explainer-text">{explanation.whatDoes}</div>
          </div>
          <div className="explainer-section">
            <div className="explainer-label">Why am I seeing it?</div>
            <div className="explainer-text">{explanation.whySeeing}</div>
          </div>
        </div>
        <div className="explainer-footer">
          <button className="btn btn-secondary btn-sm" onClick={closeExplanation} type="button">
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
