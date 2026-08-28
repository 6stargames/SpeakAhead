# **Strategic Interface Redesign for Augmentative and Alternative Communication Systems**

## **Introduction: Realigning the Design Paradigm**

Augmentative and Alternative Communication (AAC) systems are not merely software applications; they serve as the synthesized voice and the communicative identity of the individual utilizing them. The engineering architecture of the current system successfully integrates highly advanced technologies—such as offline, on-device speech transcription, real-time audio processing, and artificial intelligence-assisted conversational expansion1. However, an analysis of the existing user interface reveals a fundamental architectural misalignment: it is optimized for the observer rather than the speaker. By prioritizing a sprawling transcription column over the generative phrase board, relying heavily on character-by-character typing, and failing to provide robust alternative access modalities, the current design exacerbates the most critical challenge in the AAC domain: the communication rate1.  
Unaided or poorly aided AAC users often operate at communication rates below fifteen words per minute, standing in stark contrast to the roughly one hundred and fifty words per minute typical of natural human speech1. Every interface friction point—whether a shifting button, an opaque settings menu, an ambiguous icon, or a poorly timed scan loop—inevitably widens this gap, resulting in social exclusion, extreme cognitive fatigue, and communicative breakdown3. Furthermore, the system must navigate stringent legal frameworks, such as the Illinois Biometric Information Privacy Act (BIPA), ensuring that voiceprints and biometric data remain strictly on-device without compromising the fluidity of the interface5.  
This report provides an exhaustive, evidence-based design rationale to overhaul the current AAC interface. By establishing concrete clinical user profiles, re-arguing screen real estate, defining alternative access methodologies, mapping a standardized visual system, and establishing protocols for urgency and lexical personalization, this analysis will guide the transformation of the software from a fragile engineering prototype into a clinical-grade communicative prosthesis.

## **01\. User Profiles and Modality Constraints**

Designing for an "average" AAC user is a methodological fallacy; the population encompasses highly divergent physical, cognitive, and linguistic profiles1. A design that averages the needs of a stroke survivor, a child with cerebral palsy, and an adult with a progressive neurodegenerative disease ultimately serves none of them1. The interface must accommodate these extremes through flexible, user-specific configurations rather than a singular compromised layout. The design system will be anchored against three distinct user profiles, representing the core populations the system currently fails to serve.

| Profile Indicator | Profile A: Maria (Acquired Aphasia Post-Stroke) | Profile B: Julian (Lifelong Cerebral Palsy) | Profile C: Robert (Progressive Motor Neurone Disease) |
| :---- | :---- | :---- | :---- |
| **Physical Ability** | Hemiparesis; one functional hand for touch access. Limited fine motor control resulting in targeting tremors. | Severe dyskinetic motor impairment. Cannot point, swipe, or touch the screen accurately. | Rapidly declining motor function. Transitioning from weak, inaccurate touch to strict eye-gaze control. |
| **Cognitive & Linguistic** | Language comprehension intact, but severe word-finding deficits and acquired alexia/agraphia limit reading ability. | Cognitively intact. Highly fluent with spatial motor-planning arrays. Pre-literate or developing literacy. | Cognitively intact. Fully literate. Requires high-efficiency text generation to convey complex professional or medical thoughts. |
| **Access Modality** | Direct touch (requires extreme target sizes to mitigate tremor). | Switch access (two-switch step scanning mounted to mobility hardware). | Eye tracking (dwell selection via infrared camera or appearance-based webcam tracking). |
| **Communication Rate** | 10–15 words per minute. Highly reliant on visual symbols over text to bypass reading deficits. | 20–30 words per minute. Highly dependent on consistent layout; severely penalized by reflowing UI elements. | Declining rate; reliant on predictive text, message banking, and optimized dwell times to preserve output. |
| **Design Imperative** | Symbol-supported communication, intuitive flat navigation, high contrast, and massive hit areas. | Absolute spatial consistency (no reflowing grids) to support motor planning, and logical DOM structure for scanning. | Fatigue reduction, Midas-touch mitigation, integration of personalized synthetic voice (PSV), and text density. |

Maria represents the acquired language disorder demographic. She understands spoken language perfectly but struggles to decode text under the pressure of real-time conversation1. A text-only grid excludes her entirely. She utilizes a tablet with her non-dominant, functional hand. Her target acquisitions are slow and prone to resting tremor. For Maria, the system must utilize a highly recognizable symbol set, categorize concepts spatially, and ensure that target hit areas far exceed the standard web minimums to prevent catastrophic accidental selections that derail her train of thought.  
Julian has utilized AAC since childhood. He relies on principles of Language Acquisition through Motor Planning (LAMP)8. Julian does not "read" his board in the traditional sense; he relies entirely on the muscle memory of a word's absolute spatial location on the screen10. If a grid reflows due to viewport changes, or if an artificial intelligence prediction inserts a temporary button that shifts the layout, Julian's communication rate plummets and his cognitive load spikes1. Because he accesses the device using a two-switch scanning setup mounted to his wheelchair, the interface must be highly predictable1.  
Robert is an adult who recently lost his natural speech due to Amyotrophic Lateral Sclerosis (ALS), a form of Motor Neurone Disease (MND). He is fully literate, possesses a vast vocabulary, and is easily frustrated by interfaces that appear juvenile or overly simplified1. As his motor function deteriorates, he is transitioning from a touchscreen to an eye-tracking module1. Robert requires seamless integration of his "banked" voice (a Personalized Synthetic Voice or PSV) to maintain his identity14. His primary barrier is the "Midas touch" problem—the inability to visually scan the screen without accidentally triggering a selection16.

## **02\. Spatial Proportions and Screen Topology**

The current interface dedicates the vast majority of its visual real estate to a conversation transcript, relegating the composition area, phrase boards, and settings to a stacked, tabbed panel on the right side of the screen1. This layout serves an observer or a conversational partner reading the screen, fundamentally disempowering the user who must expend excessive visual and motor energy to locate and trigger their own voice.  
The transcript is inherently a passive element. While it assists users with short-term memory deficits or those verifying what the on-device AI transcribed from the room, it does not generate speech. Conversely, the phrase grid and composition tools are active elements. A foundational rule of AAC interface design is that generative communication tools must occupy the primary interaction zone—typically the lower two-thirds of the screen, closest to the user's hands or central gaze locus, to minimize travel time and physical exertion18. The design must abandon the single-screen paradigm in favor of state-driven multimodal layouts that prioritize generation over observation.

### **Concept 1: The Communicator-Centric Grid (Default Generative State)**

This layout reverses the current hierarchy, dedicating seventy-five percent of the screen space to the generative phrase board and core vocabulary. The top fifteen percent functions as the Output Ribbon, a persistent message composition window displaying the currently constructed utterance, accompanied by a prominent "Speak" button. The left ten percent acts as the Navigation Spine, housing vertical, static category toggles such as Quick Phrases, Core Words, Keyboard, and Settings. Vertical alignment prevents interference with horizontal eye-scanning sweeps and reduces the physical reach distance for touch users. The remaining seventy-five percent at the bottom is the Generative Grid, a strictly locked, non-reflowing matrix of vocabulary and phrases. The primary trade-off of this design is that the transcript is hidden or reduced to a minimal ticker, prioritizing rapid speech generation but requiring the user to explicitly toggle a view to read previous context.

### **Concept 2: The Contextual Dashboard (High-Information State)**

Designed specifically for high-information environments—such as medical appointments, legal consultations, or phone calls where context retention is critical—this layout splits the screen vertically1. The left forty percent acts as the Context and Transcript column, where the running conversation is displayed. Artificial intelligence-proposed replies appear at the bottom of this column, distinctly separated from the user's permanent motor-plan grid. The right sixty percent retains the Generative Grid and keyboard. The trade-off in this configuration is that target sizes in the generative grid must be reduced to accommodate the split screen, which may negatively impact touch users with tremors (like Maria) and increase the visual search time for eye-gaze users (like Robert)19.

### **The AI Agent Constraint and Staging**

The system features an AI agent that proposes replies and expands shorthand based on the room's transcription. A load-bearing constraint of the redesign is that this agent must never speak unprompted1. If the interface makes it too easy to speak an AI suggestion, the system risks committing the user to medical, financial, or social statements they did not intend, fundamentally violating their autonomy1. In the layout, AI proposals must be quarantined to a "Suggestion Bar" located distinctly away from the primary motor plan. These suggestions must require an explicit, deliberate user action to be moved into the message composition window, acting as a cognitive air gap. Only after the suggestion is staged in the composition window can the user initiate a second action to speak it.

## **03\. Non-Touch Selection: Overcoming the Midas Touch**

The current system relies entirely on touch or traditional mouse pointer input, actively excluding users with severe motor impairments1. Integrating switch scanning and eye gaze cannot be relegated to an accessibility overlay applied at the end of the development cycle; these modalities dictate the underlying document object model (DOM) and the spatial architecture of the interface.

### **Eye Gaze and the Midas Touch Problem**

Eye-tracking interfaces rely on the user fixating on a target to select it20. However, the human eye is inherently an organ of observation, constantly darting in saccades to acquire visual information17. If every fixation triggers a selection, the user experiences the "Midas Touch" problem—everything they look at is unintentionally activated, much like the mythical king who turned everything to gold16.  
To mitigate this, the system must utilize dwell time selection paired with immediate, unambiguous visual feedback17. A user must hold their gaze on a target for a specified duration to trigger a selection22. Research indicates that dwell times typically range between 350 milliseconds and 1000 milliseconds, depending on the user's executive control and the presence of ocular conditions like nystagmus22. The system must allow users to globally adjust this threshold. The visual system must communicate the progression of the dwell timer through a shrinking radial progress circle or a high-contrast filling background that originates from the center of the target23. Furthermore, the interface must include dedicated "safe zones" or "rest buttons" where the user can park their gaze without triggering any action, allowing them to visually rest while maintaining an active screen23. Advanced implementations should also support dynamic dwell times, where the system algorithmically reduces the required dwell time for highly predictable next-keys based on linguistic models, thereby increasing typing speed without sacrificing accuracy16.  
Eye tracking also suffers from calibration drift, where changes in the user's head position, ambient lighting, or pupil dilation cause the tracking accuracy to degrade over time26. To account for this spatial imprecision, the interface must enforce large target areas with substantial margins, ensuring that a slightly offset gaze point still registers within the intended cell rather than triggering an adjacent function13.

### **Switch Scanning Mechanics**

For users like Julian who cannot use eye gaze or direct touch, switch scanning is the primary access method. A cursor or highlight automatically moves across the interface, and the user presses a physical switch (such as a head switch or a sip-and-puff mechanism) when the desired item is highlighted1.  
Linear scanning—where the highlight moves item by item through a grid of thirty-six or more words—is mathematically too slow to support functional communication24. The system must implement row-column scanning1. In this paradigm, the highlight first scans vertically down the rows. When the user hits the switch, the highlight locks the row and begins scanning horizontally across the columns until the target is reached and a second switch hit confirms the selection24. The scanning rate must be customizable to provide a humane pace; a standard starting point is a 1000-millisecond step rate. Because missing a target in row-column scanning imposes immense cognitive load and frustration (requiring the user to wait for the entire loop to restart), the system should natively support a two-switch setup where the secondary switch reverses the scan direction.  
Scanning requires the interface to have a clear, strictly logical structure. For touch users, this means user interface elements must be perfectly aligned in structural grids rather than scattered organically across the viewport.

### **Escaping the Scan Loop: Emergency Access**

If a user is operating a row-column scanner and a physiological emergency occurs, navigating sequentially to a standard emergency button may take ten to fifteen seconds—a potentially fatal delay. The system architecture must support a global interrupt sequence, such as a "Long Press" (holding the switch for three seconds) or a rapid "Double Click" hardware interrupt, that instantly bypasses the screen's scan loop, halts all current actions, and immediately triggers the Emergency Override state1.

## **04\. Linguistic Architecture, Symbol Strategy, and Iconicity**

The current text-only interface operates under the flawed assumption that all users are fully literate and can rapidly decode text under cognitive load or physical stress1. To serve pre-literate children and adults with acquired aphasia, the interface must deploy a dual-modality visual system that intelligently combines text and symbols28.

### **Symbol Iconicity and Selection**

Symbol sets vary significantly in their "iconicity"—the degree to which the visual representation resembles its real-world referent7. Transparent symbols are readily guessable, such as a photograph of a cup representing the concept of a drink7. Translucent symbols require a brief explanation but are easily understood thereafter, such as an arrow pointing upward to represent the concept of "up"7. Opaque symbols, such as Blissymbolics, are highly abstract and require significant cognitive effort and learning to decode1.  
The system should adopt ARASAAC (Aragonese Portal of Augmentative and Alternative Communication) as its default symbol set. ARASAAC is free, open-source under a Creative Commons license, and highly standardized1. This makes it legally and financially viable for a standalone software product, completely avoiding the heavy, restrictive licensing fees associated with commercial sets like Widgit or Picture Communication Symbols (PCS)1.

### **The Core Vocabulary Paradigm**

Clinical research, notably the University of North Carolina's Project Core, demonstrates that a minute fraction of the human lexicon accounts for the vast majority of daily communication30. Project Core researchers have identified thirty-six "Universal Core" words that provide maximum communicative efficiency31.

| Pronouns | Verbs | Prepositions & Adjectives | Questions & Social |
| :---- | :---- | :---- | :---- |
| I, You, He, She, It, They | Want, Go, Stop, Make, Get, Put, Look, Turn, Do, Help, Open | In, On, Up, Down, Good, Bad, Same, Different, More, All | Who, What, Where, When, Why, How, Here, Not, Finished |

Table 1: The 36 Universal Core Words, categorizing the highest-frequency utility concepts across all contexts30.  
These thirty-six words yield an extraordinarily high CARE (Communication, Access, Rate, and Efficiency) score, meaning that a user can generate a wider variety of distinct communicative intents with these thirty-six concepts than they could with a board of over one hundred highly specific nouns34. The interface must feature a permanent home screen grid containing these core words. These words are highly versatile and cross-contextual, allowing users to build generative sentences rapidly without navigating through deep, cognitively taxing category folders30.

### **Resolving the Dignity Tension**

While symbols are essential for users like Maria who have aphasia, users like Robert—who are fully literate and navigating the loss of their adult identity—frequently find symbols patronizing, infantile, and visually cluttered1. The interface must feature a global toggle that dictates the presentation mode. The first mode, "Symbol \+ Text," serves pediatric and aphasia populations. The second mode, "Text Only (High Density)," caters to literate adults, allowing the removal of symbol graphics, which in turn permits smaller grid targets, higher vocabulary density per page, and a distinctly mature aesthetic interface.

## **05\. Lexical Personalization and Progressive Disclosure**

A static board of thirty-two generic phrases represents a critical failure in AAC design1. Human vocabulary is deeply personal; an individual requires rapid, frictionless access to the names of their children, their specific medical interventions, and their unique colloquialisms.

### **Core Versus Fringe Vocabulary**

While the thirty-six Universal Core words should be permanently locked in absolute spatial positions on the home screen to facilitate rapid motor planning8, the system must support infinite "Fringe" vocabulary18. Fringe vocabulary includes specific nouns, names of family members, locations, and highly specific verbs. This vocabulary must be organized into logical, categorical folders (e.g., "People," "Places," "Food") that are accessible via the Navigation Spine. Clinical consensus dictates that navigation should be limited to two or three levels maximum; deep navigation hierarchies geometrically increase cognitive load and decimate communication rates18.

### **Progressive Vocabulary Masking**

When introducing an AAC system to a new user, or a user with declining cognitive endurance, presenting sixty or more buttons simultaneously can induce severe cognitive overload19. However, starting with a basic four-button grid and subsequently changing the layout to an eight-button grid as the user learns completely destroys their motor planning. The user is forced to relearn the spatial location of the word "want" every time the grid expands8.  
The system must solve this through Progressive Vocabulary Masking (a methodology heavily supported by Caron, Light, & Drager, 2016\)18. In this architecture, the entire high-density grid is programmed and structurally present from day one, but extraneous words are visually hidden (masked) and rendered inactive. As the user's competency grows, words are unmasked and revealed in their permanent spatial locations. This location-centered design allows vocabulary to expand developmentally while perfectly preserving the user's existing muscle memory18.

### **The Caregiver Editing Flow**

Vocabulary management is frequently performed by a speech-language pathologist, a caregiver, or a family member rather than the primary user1. The editing flow must be strictly sandboxed from the conversational interface to prevent accidental modifications or deletions during active communication. Accessing the edit mode should require a secure toggle, such as a three-second continuous hold on a hidden interface element or a PIN entry. Once unlocked, the interface must shift into a distinct visual state—for instance, displaying a highly visible hatched border around the screen perimeter—to signal that the device is no longer in communication mode. Editing must occur in-place; a caregiver taps an empty cell in a fringe folder to open a modal window. As they input text, the system should automatically query the local ARASAAC symbol database to bind a corresponding image. The system then automatically color-codes the cell according to its semantic class, ensuring the visual system remains intact without requiring the caregiver to understand linguistic tagging.

## **06\. The Visual System and Design Tokens**

The visual design system of an AAC prosthesis cannot be driven by contemporary, aesthetic web trends; it must be rigorously rooted in accessibility standards, cognitive psychology, and semantic coding to minimize visual search times and reduce cognitive fatigue.

### **Semantic Color Coding: The Modified Fitzgerald Key**

To drastically reduce the time it takes a user to visually locate a specific word on a dense grid, the interface must employ color-coding based on the grammatical function of the word37. The recognized industry standard is the Modified Fitzgerald Key37. Applying consistent background colors or thick border colors allows users to rapidly scan the board for the specific part of speech they need to build a syntactically correct sentence40.

| Grammatical Category | Modified Fitzgerald Key Color | Implementation Rationale & Examples |
| :---- | :---- | :---- |
| **Pronouns** | Yellow | Subject identifiers located on the far left (I, You, He, She, It) |
| **Verbs** | Green | Action words placed adjacent to pronouns (Go, Stop, Want, Make, Turn) |
| **Adjectives / Descriptors** | Blue | Modifiers used to shape intent (Good, Different, More) |
| **Nouns** | Orange | The bulk of fringe vocabulary (Objects, Places, Food) |
| **Prepositions / Social** | Pink | Spatial relationships and greetings (In, On, Up, Hello, Please) |
| **Questions** | Purple | Interrogatives (Who, What, Where, When, Why) |
| **Important / Emergency** | Red | Critical physiological or safety alerts (Help, Pain, Breathe) |

Table 2: Implementation of the Modified Fitzgerald Key for the AAC Grid37.

### **Target Sizes and Motor Impairment Floors**

The current baseline utilized by the application—48 pixels to 60 pixels—meets general Web Content Accessibility Guidelines (WCAG) AA standards, but this is entirely insufficient for users with spasticity, athetoid movements, or resting tremors1. The design tokens must establish a strict Location-Centered Grid where buttons are as large as the viewport physically allows18. The default target size must be established at a minimum of 80 pixels by 80 pixels for standard touch access. Crucially, the system must enforce a minimum 8-pixel gap or "gutter" between all targets. This gutter absorbs slight mis-hits and prevents a resting tremor from dragging a finger across the boundary into an adjacent, unintended cell.

### **WCAG 2.2 and Focus Appearance (Success Criterion 2.4.13)**

For users employing switch scanning, keyboard navigation, or specific types of eye-tracking highlight feedback, the focus indicator must be unequivocally clear42. Relying on default browser outlines (which are often thin, low-contrast, or overridden by stylesheets) is an accessibility failure. The design must strictly adhere to WCAG 2.2 Success Criterion 2.4.13 (Focus Appearance) at the Level AAA standard42.  
This criterion dictates two absolute mathematical requirements. First, the thickness of the focus indicator must be at least as large as a 2 CSS pixel thick perimeter around the entire unfocused component42. Second, the indicator must maintain a minimum 3:1 contrast ratio against both the background behind it and the unfocused state of the button itself42. For example, a 1-pixel dotted gray outline on a white background fails instantly, as the contrast ratio is poor and the thickness is insufficient, rendering it invisible to a user with low vision scanning the board42.  
To satisfy these tokens across a multi-colored Fitzgerald Key board, the system should implement a dual-layer CSS box-shadow for focus states. By applying an inner 2-pixel white ring surrounded by a 4-pixel high-contrast dark outer ring, the focus state guarantees a 3:1 contrast ratio regardless of whether the button itself is yellow, blue, or green42. Furthermore, using outline: 2px solid transparent alongside the box shadow ensures that the focus state remains visible even if the user forces the operating system into a high-contrast forced-colors mode45.

### **Typography and High Contrast Adaptations**

Typography must utilize highly legible, sans-serif fonts with generous tracking and line height to support users with acquired dyslexia or visual processing deficits. Furthermore, a genuine high-contrast mode must be provided natively within the application. This cannot be a simple inverted CSS filter applied over the standard interface, as inverting colors corrupts the semantic meaning of the Fitzgerald Key. Instead, a dedicated token set utilizing stark yellow-on-black and cyan-on-black pairings must be crafted. This specific palette reduces photophobia—a common symptom in various neurological conditions—and significantly improves reading speed for visually impaired users without destroying the interface's organizational logic1.

## **07\. Urgency, State Changes, and Contextual Escalation**

In standard conversational software or consumer chat applications, a phrase like "Hello, good to see you" and a phrase like "I cannot breathe well" are treated with the exact same visual weight and typographical emphasis. In the context of an AAC prosthesis, this equivalence is a fatal flaw1. The device acts as the user's vocal cords, and when the user is in acute medical distress, the device must possess the capacity to shout.

### **Designing the Emergency State**

Urgent phrases cannot be buried inside a tabbed settings panel or placed at the bottom of a scrolling list; they must be pinned globally across all states of the interface1.  
When an emergency phrase is triggered, it must utilize the Fitzgerald Key "Red" token to visually demarcate its critical nature41. Activating an emergency phrase should force a global state change across the entire application user interface. For example, the output ribbon and peripheral borders should flash red, visually communicating to caregivers or onlookers in a loud environment that an alert is happening, even if the audio is temporarily obscured.

### **Auditory Override and Qualification**

The current system's behavior regarding emergency audio—muting all incoming room audio and raising the synthesized voice to full maximum volume—is clinically correct and must be preserved in the redesign1. This ensures the emergency utterance cuts through environmental noise, overriding ongoing media, background conversations, or even simultaneous screen reader audio1.  
To prevent the dilution of this emergency function, strict qualification rules must be applied to the urgent surface. An item qualifies for the red emergency override only if it relates to an immediate physiological threat (e.g., "I cannot breathe," "I am in severe pain," "I am choking," "Call 911") or severe positional distress (e.g., "My wheelchair is tipping"). Emotional distress, conversational frustration, or general discomfort do not qualify for this override and must be communicated through standard generative channels.

## **08\. Audio Architecture: Voice Banking and Synthesized Identity**

For a user who is entirely reliant on an AAC device, the synthetic voice is not merely a tool for information transfer; it is the auditory manifestation of their identity. Standard generic synthesized voices often fail to reflect a user's age, gender, regional accent, or personality, leading to a profound sense of dissociation14.

### **Personalized Synthetic Voices (PSV) and Message Banking**

For individuals with progressive conditions like ALS (Profile C), the system must seamlessly support Voice Banking12. Voice banking is the clinical process of recording an individual's natural speech while they still possess vocal clarity, which is then processed to create a Personalized Synthetic Voice (PSV)12. Modern integrations with services like Acapela, ModelTalker, or ElevenLabs allow users to generate highly accurate voice clones that can synthesize entirely novel text typed into the AAC device46.  
Simultaneously, the interface must support Message Banking. Unlike PSV, which synthesizes new sentences, message banking involves capturing direct digital recordings of specific phrases—complete with the user's exact natural intonation, laughter, or emotional inflection14. The interface must allow users to seamlessly embed these lossless audio clips into their generative grid. When a user presses a message-banked cell, the system bypasses the text-to-speech engine and plays the raw audio file, allowing them to deliver a perfectly timed, emotionally resonant phrase to a loved one14. In cases where the user has already lost their speech prior to banking, the system must support "donor voices," allowing a family member or friend with a similar regional accent to bank a voice on their behalf46.

### **Synthesis Latency and Turn-Taking**

A critical factor in the audio architecture is the latency of speech synthesis. Natural human conversational turn-taking occurs in gaps of roughly 200 milliseconds. If the AAC device takes two seconds to process the text and begin synthesizing the audio, the conversational moment has passed, and the user is spoken over49. The interface must trigger the synthesis API instantly upon the execution of the "Speak" command, prioritizing local processing speed to ensure the latency remains below the threshold required to maintain active participation in dynamic conversations49.

## **09\. Architectural Constraints: BIPA and Data Sovereignty**

The system architecture features profound legal constraints that dictate UI and UX possibilities. The software currently listens to the room, separates speakers by pitch, transcribes the conversation locally, and potentially captures the user's own vocal attempts1.

### **The Illinois Biometric Information Privacy Act (BIPA)**

Under the Illinois Biometric Information Privacy Act (740 ILCS 14), a "voiceprint" is classified as a highly protected biometric identifier, legally equivalent to a fingerprint or a retinal scan5. When artificial intelligence tools utilize speaker diarization to analyze the unique vocal tract characteristics of an individual to label a transcript with "Speaker 1" and "Speaker 2," the software is actively extracting and creating a biometric voiceprint6.  
Extracting these biometric voiceprints via speaker diarization on cloud servers without explicit, written, pre-collection consent from the individual being recorded is a direct violation of BIPA6. The financial exposure is catastrophic: the statute allows for a private right of action with statutory damages of $1,000 for each negligent violation and $5,000 for each reckless or intentional violation5. While the 2024 Senate Bill 2979 amendment limits recovery to a single violation per individual rather than per scan, the per-individual liability remains massive53.  
Because an AAC user will continuously record ambient conversations with family members, medical staff, retail workers, and strangers who have never signed biometric consent forms, **audio data and voice embeddings must never leave the device**1. The UI cannot rely on cloud-based Large Language Models (LLMs) or external transcription APIs that require audio uploads. Processing must remain entirely local.

### **UI Implications for Data Sovereignty**

To shield the developer from class-action litigation and protect the privacy of those interacting with the AAC user, the interface must explicitly signal its "Offline/Local" status. A persistent, highly visible iconography should indicate that the device is not transmitting audio to the cloud. This provides a visual guarantee—a Zero-Voiceprint Option for external cloud servers—assuring both the user and their conversation partners that their biometrics are processed strictly on-device, achieving true data sovereignty6.

## **Conclusion: Subtractions and Strategic Realignments**

The current interface is a product of technical accretion—features and readouts added by engineers to solve back-end hurdles rather than address human clinical needs. To achieve a clinical-grade AAC interface, radical subtraction is required.  
**The Subtractive Mandate:**

> 1. **Diagnostic Data in Production:** The debug outputs (e.g., 198 Hz · 12/31 voiced · speaker-1) that currently populate the interface clutter the transcript, drastically spike cognitive load, and destroy the illusion of a natural voice1. They must be removed from the user-facing UI entirely and restricted to a hidden, password-protected developer console.  
> 2. **The QWERTY Bias:** The visual dominance of the text-entry message box must be dismantled1. While a keyboard is necessary for literate users, it is the slowest possible modality, yielding only fifteen words per minute1. The visual hierarchy must elevate the Core Vocabulary grid and predictive phrases above the keyboard.  
> 3. **Reflowing Layouts:** Any responsive web design element that causes phrase buttons to dynamically shift position when a side panel is opened or when a prediction populates must be eradicated1. Motor planning requires absolute, fixed coordinates; reflowing grids destroy the automaticity required for fluid communication8.  
> 4. **The Observer Layout:** The prioritization of the transcript over the generative grid must end1. The interface is not a subtitle screen for the room; it is the vocal cords of the user.

By grounding the redesign in strict clinical user profiles, adopting the Project Core vocabulary with progressive masking, implementing the semantic organization of the Modified Fitzgerald Key, and establishing robust, low-fatigue non-touch scanning and gaze architectures, the software will transcend its current limitations. It will transition from a technical demonstration into an empowering, life-altering communicative prosthesis that honors the dignity, autonomy, and identity of the individual using it.

#### **Works cited**

> 1. DESIGN\_BRIEF.md  
> 2. A Rate Index for Augmentative and Alternative Communication, [https://www.researchgate.net/publication/225962403\_A\_Rate\_Index\_for\_Augmentative\_and\_Alternative\_Communication](https://www.researchgate.net/publication/225962403_A_Rate_Index_for_Augmentative_and_Alternative_Communication)  
> 3. Chapter: 6 Augmentative and Alternative Communication and Voice, [https://www.nationalacademies.org/read/24740/chapter/8](https://www.nationalacademies.org/read/24740/chapter/8)  
> 4. Designing AAC Research and Intervention to Improve Outcomes for, [https://aac.psu.edu/wp-content/uploads/2015/05/Light-McNaughton-2015-Outcomes-\_-AAC.pdf](https://aac.psu.edu/wp-content/uploads/2015/05/Light-McNaughton-2015-Outcomes-_-AAC.pdf)  
> 5. BIPA requirements for apps in Illinois, 2026 \- Magist, [https://magist.io/regulations/bipa](https://magist.io/regulations/bipa)  
> 6. BIPA and Voice Recordings: What Employers Need to Know, [https://summitnotes.app/blog/bipa-voice-recordings-employers/](https://summitnotes.app/blog/bipa-voice-recordings-employers/)  
> 7. Augmentative and Alternative Communication: Models and, [https://dokumen.pub/augmentative-and-alternative-communication-models-and-applications-2nbsped-9781635501308-163550130x.html](https://dokumen.pub/augmentative-and-alternative-communication-models-and-applications-2nbsped-9781635501308-163550130x.html)  
> 8. Benefits of a LAMP Words for Life-Trained Therapist \- PedsTeam, [https://pedsteam.com/benefits-of-a-lamp-words-for-life-trained-therapist/](https://pedsteam.com/benefits-of-a-lamp-words-for-life-trained-therapist/)  
> 9. Our Apps \- LAMP Words for Life®, [https://lampwflapp.com/apps/lamp-app-discover](https://lampwflapp.com/apps/lamp-app-discover)  
> 10. LAMP-Words for Life \- Ohio State Software Directory, [https://softwaredirectory.osu.edu/node/119](https://softwaredirectory.osu.edu/node/119)  
> 11. Augmentative & Alternative Communication \- ADA Therapy LLC, [https://adatherapy.net/therapies/aac.php](https://adatherapy.net/therapies/aac.php)  
> 12. Voice Banking to Support People Who Use Speech-Generating, [https://pubs.asha.org/doi/10.1044/2019\_PERS-SIG2-2018-0011](https://pubs.asha.org/doi/10.1044/2019_PERS-SIG2-2018-0011)  
> 13. Eye Gazed Communication System \- ijsret, [https://ijsret.com/wp-content/uploads/IJSRET\_V12\_issue3\_362.pdf](https://ijsret.com/wp-content/uploads/IJSRET_V12_issue3_362.pdf)  
> 14. Voice banking – Clinical information for SLTs \- RCSLT, [https://www.rcslt.org/speech-and-language-therapy/clinical-information/voice-banking/](https://www.rcslt.org/speech-and-language-therapy/clinical-information/voice-banking/)  
> 15. How People Living With Amyotrophic Lateral Sclerosis Use ... \- PMC, [https://pmc.ncbi.nlm.nih.gov/articles/PMC12379579/](https://pmc.ncbi.nlm.nih.gov/articles/PMC12379579/)  
> 16. The effects of dynamic dwell time systems on the usability of eye, [https://www.tandfonline.com/doi/full/10.1080/07370024.2025.2497236](https://www.tandfonline.com/doi/full/10.1080/07370024.2025.2497236)  
> 17. gaze-typing improves performance in the antisaccade task, [https://eprints.whiterose.ac.uk/id/eprint/184030/7/souto.marsh.hutchinson.judge.paterson.2021.CHB.pdf](https://eprints.whiterose.ac.uk/id/eprint/184030/7/souto.marsh.hutchinson.judge.paterson.2021.CHB.pdf)  
> 18. TapSpeak — Free AAC Communication App — TapSpeak, [https://tapspeak.org/](https://tapspeak.org/)  
> 19. Research — The Science Behind TapSpeak, [https://www.tapspeak.org/research](https://www.tapspeak.org/research)  
> 20. Eye Tracking Research to Answer Questions about Augmentative, [https://pmc.ncbi.nlm.nih.gov/articles/PMC4327869/](https://pmc.ncbi.nlm.nih.gov/articles/PMC4327869/)  
> 21. (PDF) Eye Tracking Research to Answer Questions about, [https://www.researchgate.net/publication/261836613\_Eye\_Tracking\_Research\_to\_Answer\_Questions\_about\_Augmentative\_and\_Alternative\_Communication\_Assessment\_and\_Intervention](https://www.researchgate.net/publication/261836613_Eye_Tracking_Research_to_Answer_Questions_about_Augmentative_and_Alternative_Communication_Assessment_and_Intervention)  
> 22. The phrase selection menu of LC Eyegaze \[Chapman 1991\]., [https://www.researchgate.net/figure/The-phrase-selection-menu-of-LC-Eyegaze-Chapman-1991\_fig5\_271368535](https://www.researchgate.net/figure/The-phrase-selection-menu-of-LC-Eyegaze-Chapman-1991_fig5_271368535)  
> 23. Writing with the Eyes: The Effect of Age on Eye-Tracking ... \- PMC \- NIH, [https://pmc.ncbi.nlm.nih.gov/articles/PMC8410387/](https://pmc.ncbi.nlm.nih.gov/articles/PMC8410387/)  
> 24. (PDF) Twenty years of eye typing \- ResearchGate, [https://www.researchgate.net/publication/271368535\_Twenty\_years\_of\_eye\_typing](https://www.researchgate.net/publication/271368535_Twenty_years_of_eye_typing)  
> 25. (PDF) Writing with Your Eye: A Dwell Time Free Writing System, [https://www.researchgate.net/publication/200777614\_Writing\_with\_Your\_Eye\_A\_Dwell\_Time\_Free\_Writing\_System\_Adapted\_to\_the\_Nature\_of\_Human\_Eye\_Gaze](https://www.researchgate.net/publication/200777614_Writing_with_Your_Eye_A_Dwell_Time_Free_Writing_System_Adapted_to_the_Nature_of_Human_Eye_Gaze)  
> 26. An Examination of Recording Accuracy and Precision From Eye, [https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2018.00803/full](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2018.00803/full)  
> 27. Impact Factor: 8.028 \- ijarasem, [https://ijarasem.com/admin/img/25\_An%20Intelligent%20Human.pdf](https://ijarasem.com/admin/img/25_An%20Intelligent%20Human.pdf)  
> 28. Augmentative and Alternative Communication (AAC) \- ASHA, [https://www.asha.org/practice-portal/professional-issues/augmentative-and-alternative-communication/](https://www.asha.org/practice-portal/professional-issues/augmentative-and-alternative-communication/)  
> 29. Universal Core Vocabulary \- Project Core, [https://project-core.com/communication-systems/](https://project-core.com/communication-systems/)  
> 30. The Importance of Core Vocabulary for Children who use AAC, [https://emergepediatrictherapy.com/the-importance-of-core-vocabulary-for-children-who-use-aac/](https://emergepediatrictherapy.com/the-importance-of-core-vocabulary-for-children-who-use-aac/)  
> 31. Universal Core vocabulary | Center for Literacy and Disability Studies, [https://www.med.unc.edu/healthsciences/clds/universal-core-vocabulary/](https://www.med.unc.edu/healthsciences/clds/universal-core-vocabulary/)  
> 32. Project Core Goals and Implementation Model, [https://project-core.com/about-project-core/](https://project-core.com/about-project-core/)  
> 33. What Core words to start with? \- Avaz Support \- Freshdesk, [https://avazapp.freshdesk.com/support/solutions/articles/11000087348-what-core-words-to-start-with-](https://avazapp.freshdesk.com/support/solutions/articles/11000087348-what-core-words-to-start-with-)  
> 34. Universal Core: AAC Vocabulary, About \- OpenAAC, [https://www.openaac.org/vocabularies/pc36](https://www.openaac.org/vocabularies/pc36)  
> 35. Augmentative and Alternative Communication for Children with, [https://pmc.ncbi.nlm.nih.gov/articles/PMC8009928/](https://pmc.ncbi.nlm.nih.gov/articles/PMC8009928/)  
> 36. Personalized Early AAC Intervention to Build Language and Literacy, [https://pmc.ncbi.nlm.nih.gov/articles/PMC8375506/](https://pmc.ncbi.nlm.nih.gov/articles/PMC8375506/)  
> 37. Communication Boards: Colorful Considerations \- PrAACtical AAC, [https://praacticalaac.org/strategy/communication-boards-colorful-considerations/](https://praacticalaac.org/strategy/communication-boards-colorful-considerations/)  
> 38. Fitzgerald Key for AAC \- Communication Community, [https://www.communicationcommunity.com/fitzgerald-key-for-aac/](https://www.communicationcommunity.com/fitzgerald-key-for-aac/)  
> 39. AUGMENTATIVE-ALTERNATIVE COMMUNICATION \- PDH Therapy, [https://pdhtherapy.com/wp-content/uploads/2020/10/PDH\_OT\_1805-Vocabulary.pdf](https://pdhtherapy.com/wp-content/uploads/2020/10/PDH_OT_1805-Vocabulary.pdf)  
> 40. CBB 8\. Colour \- TalkSense \- Weebly, [https://talksense.weebly.com/cbb-8-colour.html](https://talksense.weebly.com/cbb-8-colour.html)  
> 41. A PrAACtical Packet of AAC Resources, [https://praacticalaac.org/wp-content/uploads/filebase/downloads/PrAACtical%20Packet%20Therapy%20Materials.pdf](https://praacticalaac.org/wp-content/uploads/filebase/downloads/PrAACtical%20Packet%20Therapy%20Materials.pdf)  
> 42. WCAG 2.4.13 Focus Appearance: Complete Implementation Guide, [https://www.allaccessible.org/blog/wcag-2413-focus-appearance-guide](https://www.allaccessible.org/blog/wcag-2413-focus-appearance-guide)  
> 43. Understanding Success Criterion 2.4.13: Focus Appearance \- W3C, [https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html)  
> 44. WCAG 2.4.13 Focus Appearance: Requirement and How to Meet It, [https://www.equalweb.com/wcag/criteria/2-4-13/](https://www.equalweb.com/wcag/criteria/2-4-13/)  
> 45. 2.4.13 Focus Appearance \- AAArdvark, [https://aaardvarkaccessibility.com/wcag-plain-english/2-4-13-focus-appearance/](https://aaardvarkaccessibility.com/wcag-plain-english/2-4-13-focus-appearance/)  
> 46. AAC Voice Options | Synthetic Voices & Voice Banking, [https://www.tobiidynavox.com/pages/discover-aac-voice-options](https://www.tobiidynavox.com/pages/discover-aac-voice-options)  
> 47. ALS & Communication \- Les Turner ALS Foundation, [https://lesturnerals.org/als-communication-guide/](https://lesturnerals.org/als-communication-guide/)  
> 48. Creating Personal Voices For All, [https://modeltalker.org/](https://modeltalker.org/)  
> 49. Azure Speech Service Overview | PDF \- Scribd, [https://www.scribd.com/document/912689893/Azure-Ai-Services-Speech-Service](https://www.scribd.com/document/912689893/Azure-Ai-Services-Speech-Service)  
> 50. Azure Ai Services Speech Service | PDF \- Scribd, [https://www.scribd.com/document/770556422/Azure-Ai-Services-Speech-Service](https://www.scribd.com/document/770556422/Azure-Ai-Services-Speech-Service)  
> 51. How Biometric Privacy Laws Like Illinois BIPA Apply to AI Voice, [https://www.umevo.ai/blogs/ume-all-posts/how-biometric-privacy-laws-like-illinois-bipa-apply-to-ai-voice-recorders](https://www.umevo.ai/blogs/ume-all-posts/how-biometric-privacy-laws-like-illinois-bipa-apply-to-ai-voice-recorders)  
> 52. Jump in Facial and Voice Recognition Raises Privacy, Cybersecurity, [https://www.jacksonlewis.com/insights/jump-facial-and-voice-recognition-raises-privacy-cybersecurity-civil-liberty-concerns](https://www.jacksonlewis.com/insights/jump-facial-and-voice-recognition-raises-privacy-cybersecurity-civil-liberty-concerns)  
> 53. How Will the Recent Amendments to Illinois's BIPA Affect the Use of, [https://www.americanbar.org/groups/business\_law/resources/business-law-today/2024-june/how-will-proposed-amendments-to-illinois-bipa-affect-the-use-of-biometric-data/](https://www.americanbar.org/groups/business_law/resources/business-law-today/2024-june/how-will-proposed-amendments-to-illinois-bipa-affect-the-use-of-biometric-data/)  
> 54. ILLINOIS BIPA AMENDMENT \- Airdo Werwas, LLC, [https://www.airdowerwas.com/blog/2024/august/illinois-governor-signs-bipa-amendment-limiting-/](https://www.airdowerwas.com/blog/2024/august/illinois-governor-signs-bipa-amendment-limiting-/)  
> 55. Illinois BIPA Reform Takes Effect | King & Spalding, [https://www.kslaw.com/insights/articles/illinois-bipa-reform-takes-effect](https://www.kslaw.com/insights/articles/illinois-bipa-reform-takes-effect)