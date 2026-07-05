"""
api/agent.py — AI Agent Chat Endpoints
========================================
Routes
------
POST /agent/chat         → Process a chat message and return structured response
GET  /agent/suggestions  → Get contextual suggested questions
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.schemas.agent import ChatMessage, ChatResponse, SuggestedQuestion
from app.services.agent_service import process_message, get_suggested_questions

router = APIRouter(prefix="/agent", tags=["agent"])


@router.post("/chat", response_model=ChatResponse)
def chat(payload: ChatMessage, db: Session = Depends(get_db)):
    """
    Process a user chat message and return an AI-generated response.

    The agent classifies the intent, queries real product/pricing data,
    and returns a structured response with explanation text, data tables,
    and follow-up suggestions.

    Supported intents:
      - pricing_explanation
      - discount_suggestions
      - expiry_risk
      - competitor_comparison
      - profit_impact
      - general_greeting / general_help
    """
    return process_message(payload.message, db)


@router.get("/suggestions", response_model=List[SuggestedQuestion])
def suggestions(db: Session = Depends(get_db)):
    """
    Return contextual suggested questions based on current data state.

    Includes urgent suggestions when products are at expiry risk.
    """
    return get_suggested_questions(db)
