"""Pydantic schemas for AI agent chat API."""

from pydantic import BaseModel
from typing import Any, List, Optional


class ChatMessage(BaseModel):
    message: str


class ChatResponse(BaseModel):
    intent: str
    response_text: str
    data: Optional[Any] = None
    data_type: Optional[str] = None
    confidence: float
    suggestions: List[str] = []


class SuggestedQuestion(BaseModel):
    text: str
    category: str
    icon: str
