import os
import time
import logging
from typing import Any
from pydantic import Field
from playwright.async_api import Page
from langchain_core.tools import tool
from ...browser.dom.dom_helper import wait_for_non_loading_dom_state
from ...browser.dom.get_detailed_accessibility_tree import do_get_accessibility_info
from ..context import AgentContext, Actors
from ..event import Event, ExecutionState, EventData
from .base import BaseToolArgsWithContextSchema

logger = logging.getLogger(__name__)

class GetDomWithContentTypeArgsSchema(BaseToolArgsWithContextSchema):
    content_type: str = Field(description="""The type of content to extract. Possible values are:
                               - 'text_only': Extracts the innerText of the highest element in the document and responds with text,
                               - 'input_fields': Extracts the text input and button elements in the dom,
                               - 'all_fields': Extracts all the fields in the DOM and responds with a JSON object.""")


@tool(args_schema=GetDomWithContentTypeArgsSchema)
async def get_dom_with_content_type(context: AgentContext, content_type: str) -> dict[str, Any] | str | None:
    """
    Retrieves and processes the DOM of the active page in a browser instance based on the specified content type.
    
    Returns
    -------
    dict[str, Any] | str | None
        The processed content based on the specified content type. This could be:
        - A JSON object for 'input_fields' with just inputs.
        - Plain text for 'text_only'.
        - A minified DOM represented as a JSON object for 'all_fields'.

    Raises
    ------
    ValueError
        If an unsupported content_type is provided.
    """

    # logger.info(f"Executing Get DOM Command based on content_type: {content_type}")
    event_manager = context.event_manager
    await event_manager.emit(Event.create(
        state=ExecutionState.ACT_START,
        actor=Actors.NAVIGATOR,
        data=EventData(
            task_id=context.task_id,
            step=context.step,
            tool_round=context.tool_round,
            tool="get_dom_with_content_type",
            details=f"Executing Get DOM Command based on content_type: {content_type}"
        )
    ))
    
    start_time = time.time()
    # Create and use the PlaywrightManager
    browser_context = context.browser_context
    page = await browser_context.get_current_page()
    if page is None: # type: ignore
        raise ValueError('No active page found. OpenURL command opens a new page.')

    extracted_data = None
    await wait_for_non_loading_dom_state(page, 2000) # wait for the DOM to be ready, non loading means external resources do not need to be loaded
    user_success_message = ""
    if content_type == 'all_fields':
        user_success_message = "Fetched all the fields in the DOM"
        extracted_data = await do_get_accessibility_info(page, only_input_fields=False, log_dir=context.path_manager.logs)
    elif content_type == 'input_fields':
        logger.debug('Fetching DOM for input_fields')
        extracted_data = await do_get_accessibility_info(page, only_input_fields=True, log_dir=context.path_manager.logs)
        if extracted_data is None:
            return "Could not fetch input fields. Please consider trying with content_type all_fields."
        user_success_message = "Fetched only input fields in the DOM"
    elif content_type == 'text_only':
        # Extract text from the body or the highest-level element
        logger.debug('Fetching DOM for text_only')
        text_content = await get_filtered_text_content(page)

        with open(os.path.join(context.path_manager.logs, 'text_only_dom.txt'), 'w',  encoding='utf-8') as f:
            f.write(text_content)
        extracted_data = text_content
        user_success_message = "Fetched the text content of the DOM"
    else:
        raise ValueError(f"Unsupported content_type: {content_type}")

    elapsed_time = time.time() - start_time
    logger.info(f"Get DOM Command executed in {elapsed_time} seconds")
    # await browser_manager.notify_user(user_success_message, message_type=MessageType.ACTION)
    await event_manager.emit(Event.create(
        state=ExecutionState.ACT_OK,
        actor=Actors.NAVIGATOR,
        data=EventData(
            task_id=context.task_id,
            step=context.step,
            tool_round=context.tool_round,
            tool="get_dom_with_content_type",
            details=user_success_message
        )
    ))

    return extracted_data # type: ignore


async def get_filtered_text_content(page: Page) -> str:
    text_content = await page.evaluate("""
        () => {
            // Array of query selectors to filter out
            const selectorsToFilter = ['#agente-overlay'];

            // Store the original visibility values to revert later
            const originalStyles = [];

            // Hide the elements matching the query selectors
            selectorsToFilter.forEach(selector => {
                const elements = document.querySelectorAll(selector);
                elements.forEach(element => {
                    originalStyles.push({ element: element, originalStyle: element.style.visibility });
                    element.style.visibility = 'hidden';
                });
            });

            // Get the text content of the page
            let textContent = document?.body?.innerText || document?.documentElement?.innerText || "";

            // Get all the alt text from images on the page
            let altTexts = Array.from(document.querySelectorAll('img')).map(img => img.alt);
            altTexts="Other Alt Texts in the page: " + altTexts.join(' ');

            // Revert the visibility changes
            originalStyles.forEach(entry => {
                entry.element.style.visibility = entry.originalStyle;
            });
            textContent=textContent+" "+altTexts;
            return textContent;
        }
    """)
    return text_content

