// Grip To-Do App - Frontend JavaScript (Supabase-backed)

class TodoApp {
    constructor() {
        this.todos = [];
        this.projects = [];
        this.completedProjects = [];
        this.areas = [];
        this.goals = [];
        this.currentView = { type: "list", value: "today" };
        this.availableLists = ["inbox", "today"];
        this.availablePriorities = ["not_set", "low", "medium", "high"];
        this.addTaskVisible = false;
        this.openTodoId = null;
        this.expandedAreaIds = new Set();
        this.expandedGoalIds = new Set();
        this.editingAreaId = null;
        this.editingGoalId = null;
        this.calendarSubscriptions = [];
        this.calendarEventsByRange = new Map(); // "from|to" -> events
        this.weekAddDay = null;
        this.collapsedWeekDays = new Set();
        this.todayAgendaOpen = localStorage.getItem("gripTodayAgendaOpen") === "1";
        // Task IDs completed today. Persisted with the current date so the set
        // auto-clears at midnight; lets the Today view keep showing tasks that
        // were checked off today for a sense of progress.
        this._completedTodayIds = this._loadCompletedTodayIds();
        this._statusTimer = null;

        // Timer / pomodoro state
        this.activeSession = null;       // { kind, task_id, started_at, phase_seconds, cycle_index, ... }
        this.pomodoroSettings = null;    // server-loaded; null means defaults
        this._pillTickHandle = null;
        this._chimeAudioCtx = null;      // lazy WebAudio fallback when no MP3
        this._notifyAsked = false;
        this.timeEntriesByTask = new Map();  // task_id -> array (cached for modal)
        this.statsRangeOffset = 0;       // 0 = current week, -1 = previous, +1 = next
        this.statsKindFilter = "all";    // all | stopwatch | pomodoro

        this.cacheElements();
        this.bindEvents();
        this._tbBindOnce();
        this.boot();
    }

    async boot() {
        // Load areas & goals first so the sidebar tree and selects can render
        // with the correct data before todos/projects trigger re-renders.
        await Promise.all([this.loadAreas(), this.loadGoals()]);
        this.renderAreaTree();
        this._populateAreaSelects();
        await Promise.all([this.loadProjects(), this.loadCompletedProjects(), this.loadTodos()]);
        // Apply the initial view now that data is loaded so the right panel
        // becomes visible (panels are `hidden` in HTML by default).
        this.setView(this.currentView);
        this.loadCalendarSubscriptions();
        // Timer state — load and start the pill if a session is active.
        this.loadPomodoroSettings();
        this.refreshActiveSession();
    }

    cacheElements() {
        this.todoInput = document.getElementById("todoInput");
        this.addButton = document.getElementById("addBtn");
        this.addTaskToggle = document.getElementById("addTaskToggle");
        this.addTaskModal = document.getElementById("addTaskModal");
        this.addTaskModalClose = document.getElementById("addTaskModalClose");
        this.addTaskModalCancel = document.getElementById("addTaskModalCancel");
        this.areaSelect = document.getElementById("areaSelect");
        this.prioritySelect = document.getElementById("prioritySelect");
        this.startDateInput = document.getElementById("startDateInput");
        this.plannedDateInput = document.getElementById("plannedDateInput");
        this.plannedTimeInput = document.getElementById("plannedTimeInput");
        this.deadlineInput = document.getElementById("deadlineInput");
        this.durationInput = document.getElementById("durationInput");
        this.recurrenceUnit = document.getElementById("recurrenceUnit");
        this.recurrenceInterval = document.getElementById("recurrenceInterval");
        this.recurrenceEnd = document.getElementById("recurrenceEnd");
        this.recurrenceEndLabel = document.getElementById("recurrenceEndLabel");
        this.todoList = document.getElementById("todoList");
        this.itemCount = document.getElementById("itemCount");
        this.clearCompletedButton = document.getElementById("clearCompleted");
        this.statusMessage = document.getElementById("statusMessage");
        this.activeListLabel = document.getElementById("activeListLabel");
        this.sidebarItems = Array.from(
            document.querySelectorAll(".sidebar-item")
        );
        // Modal elements
        this.taskModal = document.getElementById("taskModal");
        this.modalCloseBtn = document.getElementById("modalCloseBtn");
        this.modalDeleteBtn = document.getElementById("modalDeleteBtn");
        this.modalCheckbox = document.getElementById("modalCheckbox");
        this.modalTitleInput = document.getElementById("modalTitleInput");
        this.modalState = document.getElementById("modal-state");
        this.modalList = document.getElementById("modal-list");
        this.modalPlannedDate = document.getElementById("modal-planned-date");
        this.modalPlannedTime = document.getElementById("modal-planned-time");
        this.modalStartDate = document.getElementById("modal-start-date");
        this.modalDuration = document.getElementById("modal-duration");
        this.modalDeadline = document.getElementById("modal-deadline");
        this.modalPriority = document.getElementById("modal-priority");
        this.modalArea = document.getElementById("modal-area");
        this.modalRecurrenceUnit = document.getElementById("modal-recurrence-unit");
        this.modalRecurrenceInterval = document.getElementById("modal-recurrence-interval");
        this.modalRecurrenceEnd = document.getElementById("modal-recurrence-end");
        // Mobile sidebar
        this.sidebar = document.querySelector(".sidebar");
        this.sidebarOverlay = document.getElementById("sidebarOverlay");
        this.mobileMenuBtn = document.getElementById("mobileMenuBtn");
        // Projects
        this.projectSelect = document.getElementById("projectSelect");
        this.modalProject = document.getElementById("modal-project");
        this.projectActionsEl = document.getElementById("projectActions");
        this.archiveProjectBtn = document.getElementById("archiveProjectBtn");
        this.reviveProjectBtn = document.getElementById("reviveProjectBtn");
        this.projectMenuWrap = document.getElementById("projectMenuWrap");
        this.projectMenuBtn = document.getElementById("projectMenuBtn");
        this.projectMenu = document.getElementById("projectMenu");
        this.projectMenuFavLabel = document.getElementById("projectMenuFavLabel");
        // Pinned-to-today projects are persisted server-side via project.show_on_today.
        // We keep a Set of legacy localStorage values so we can migrate them once on
        // first load if the server has no pinned projects yet.
        this._legacyTodayProjectIds = new Set(
            JSON.parse(localStorage.getItem("gripTodayProjects") || "[]").map(Number)
        );
        this.projectNav = document.getElementById("projectNav");
        this.projectArchivedNav = document.getElementById("projectArchivedNav");
        this.addProjectBtn = document.getElementById("addProjectBtn");
        this.newProjectForm = document.getElementById("newProjectForm");
        this.newProjectInput = document.getElementById("newProjectInput");
        // Areas & Goals
        this.areaNav = document.getElementById("areaNav");
        this.addAreaBtn = document.getElementById("addAreaBtn");
        this.areaModal = document.getElementById("areaModal");
        this.areaModalCloseBtn = document.getElementById("areaModalCloseBtn");
        this.areaModalCancel = document.getElementById("areaModalCancel");
        this.areaModalSave = document.getElementById("areaModalSave");
        this.areaModalTitle = document.getElementById("areaModalTitle");
        this.areaNameInput = document.getElementById("areaNameInput");
        this.areaColorInput = document.getElementById("areaColorInput");
        this.areaDescriptionInput = document.getElementById("areaDescriptionInput");
        this.goalModal = document.getElementById("goalModal");
        this.goalModalCloseBtn = document.getElementById("goalModalCloseBtn");
        this.goalModalCancel = document.getElementById("goalModalCancel");
        this.goalModalSave = document.getElementById("goalModalSave");
        this.goalModalTitle = document.getElementById("goalModalTitle");
        this.goalNameInput = document.getElementById("goalNameInput");
        this.goalAreaSelect = document.getElementById("goalAreaSelect");
        this.goalStartDateInput = document.getElementById("goalStartDateInput");
        this.goalEndDateInput = document.getElementById("goalEndDateInput");
        this.goalDescriptionInput = document.getElementById("goalDescriptionInput");
        // Calendar (Apple Calendar via ICS)
        this.calendarNav = document.getElementById("calendarNav");
        this.addCalendarBtn = document.getElementById("addCalendarBtn");
        this.calendarModal = document.getElementById("calendarModal");
        this.calendarModalCloseBtn = document.getElementById("calendarModalCloseBtn");
        this.calendarModalCancel = document.getElementById("calendarModalCancel");
        this.calendarModalSave = document.getElementById("calendarModalSave");
        this.calendarNameInput = document.getElementById("calendarNameInput");
        this.calendarUrlInput = document.getElementById("calendarUrlInput");
        this.calendarColorInput = document.getElementById("calendarColorInput");
        this.calendarColorField = document.getElementById("calendarColorField");
        this.calendarAreaSelect = document.getElementById("calendarAreaSelect");
        this.calendarModalTitle = document.getElementById("calendarModalTitle");
        this.calendarModalError = document.getElementById("calendarModalError");
        this.editingCalendarSubscriptionId = null;
        this.todayAgendaList = document.getElementById("todayAgendaList");
        this.todayAgendaTitle = document.getElementById("todayAgendaTitle");
        this.agendaNowLabel = document.getElementById("agendaNowLabel");
        // Project view (kanban)
        this.projectView = document.getElementById("projectView");
        this.projHead = document.getElementById("projHead");
        this.projCols = document.getElementById("projCols");
        this.projectBackBtn = document.getElementById("projectBackBtn");
        this.contentTitleBlock = document.getElementById("contentTitleBlock");
        // Tijdblokken (daily planner) — rendered inside the Today view
        this._tbDate = new Date();
        this._tbDate.setHours(0, 0, 0, 0);
        this._tbBlocks = []; // built lazily from calendar + tasks
        this._tbBlocksOverrides = new Map(); // user edits keyed by block id
        this._tbExtraBlocks = []; // user-added (templates, manual) for today
        this._tbScheduledTaskIds = new Set(); // pool items moved into the timeline
        this._tbDateLabel = "";
        this._tbNuTimer = null;
        // Next-week view (blueprint)
        this.nextWeekView = document.getElementById("nextWeekView");
        this.nextWeekHeaderTools = document.getElementById("nextWeekHeaderTools");
        this.nextWeekLabel = document.getElementById("nextWeekLabel");
        this.nextWeekPrevBtn = document.getElementById("nextWeekPrevBtn");
        this.nextWeekNextBtn = document.getElementById("nextWeekNextBtn");
        this.nextWeekStrip = document.getElementById("nextWeekStrip");
        this.nextWeekDays = document.getElementById("nextWeekDays");
        this.nextWeekFootSummary = document.getElementById("nextWeekFootSummary");
        this.nextWeekBudgetBars = document.getElementById("nextWeekBudgetBars");
        this.nextWeekBudgetLegend = document.getElementById("nextWeekBudgetLegend");
        this.nextWeekBudgetCapLabel = document.getElementById("nextWeekBudgetCapLabel");
        this.nextWeekDeadlinesList = document.getElementById("nextWeekDeadlinesList");
        this.nextWeekDeadlinesSub = document.getElementById("nextWeekDeadlinesSub");
        // Plan week modal
        this.planWeekModal = document.getElementById("planWeekModal");
        this.planWeekRows = document.getElementById("planWeekRows");
        this.planWeekSub = document.getElementById("planWeekSub");
        this.planWeekTotal = document.getElementById("planWeekTotal");
        this.planWeekSave = document.getElementById("planWeekSave");
        this.planWeekClose = document.getElementById("planWeekClose");
        this.nextWeekOffset = 1;
        // Categories drive the dynamic Tijdsbudget block. The keyword is
        // matched (case-insensitive) against the ICS DESCRIPTION field. Add
        // more categories here as they become defined.
        this.nextWeekBudgetCategories = [
            { keyword: "DEEP", label: "Diep werk", className: "focus", color: "var(--ink)" },
            { keyword: "MEET", label: "Meeting", className: "meet", color: "var(--ink-tertiary)" },
            { keyword: "FAM",  label: "Familie & vrienden", className: "life", color: "var(--area-3)" },
        ];
        this.nextWeekBudgetCapacityMinutes = 45 * 60;
        // Today view (integrated)
        this.todayView = document.getElementById("todayView");
        this.todayHeadline = document.getElementById("todayHeadline");
        this.todaySub = document.getElementById("todaySub");
        this.todayGoals = document.getElementById("todayGoals");
        this.todayTasks = document.getElementById("todayTasks");
        this.todayHeaderTools = document.getElementById("todayHeaderTools");
        this.todayFocusBtn = document.getElementById("todayFocusBtn");
        this.todayBellBtn = document.getElementById("todayBellBtn");
        this.todayNewTaskBtn = document.getElementById("todayNewTaskBtn");
        // Streaks panel
        this.streakDaysNum = document.getElementById("streakDaysNum");
        this.streakTodayCount = document.getElementById("streakTodayCount");
        this.streakWeek = document.getElementById("streakWeek");
        // Focus widget
        this.focusClock = document.getElementById("focusClock");
        this.focusTask = document.getElementById("focusTask");
        this.focusProgress = document.getElementById("focusProgress");
        this.focusPauseBtn = document.getElementById("focusPauseBtn");
        this.focusStopBtn = document.getElementById("focusStopBtn");
        this.focusCycles = document.getElementById("focusCycles");
        this.focusCycleLabel = document.getElementById("focusCycleLabel");
        this.focusCyclePips = document.getElementById("focusCyclePips");
        this.focusPanelLabel = document.getElementById("focusPanelLabel");
        // Search modal
        this.sidebarSearchBtn = document.getElementById("sidebarSearch");
        this.searchModal = document.getElementById("searchModal");
        this.searchModalInput = document.getElementById("searchModalInput");
        this.searchResults = document.getElementById("searchResults");
        this.searchModalEmpty = document.getElementById("searchModalEmpty");
        this._searchActiveIndex = 0;
        this._searchHits = [];
        // Timer pill
        this.timerPill = document.getElementById("timerPill");
        this.timerPillBody = document.getElementById("timerPillBody");
        this.timerPillIcon = document.getElementById("timerPillIcon");
        this.timerPillPhase = document.getElementById("timerPillPhase");
        this.timerPillTask = document.getElementById("timerPillTask");
        this.timerPillClock = document.getElementById("timerPillClock");
        this.timerPillCycles = document.getElementById("timerPillCycles");
        this.timerPillSkip = document.getElementById("timerPillSkip");
        this.timerPillStop = document.getElementById("timerPillStop");
        this.timerChime = document.getElementById("timerChime");
        // Modal Tijd section
        this.modalTimeField = document.getElementById("modalTimeField");
        this.modalTimeTotal = document.getElementById("modalTimeTotal");
        this.modalTimePomodoros = document.getElementById("modalTimePomodoros");
        this.modalTimeEntries = document.getElementById("modalTimeEntries");
        this.modalStartPomodoro = document.getElementById("modalStartPomodoro");
        this.modalPauseTimer = document.getElementById("modalPauseTimer");
        this.modalStopTimer = document.getElementById("modalStopTimer");
        // Settings modal
        this.settingsModal = document.getElementById("settingsModal");
        this.settingsModalClose = document.getElementById("settingsModalClose");
        this.settingsModalCancel = document.getElementById("settingsModalCancel");
        this.settingsModalSave = document.getElementById("settingsModalSave");
        this.themePicker = document.getElementById("themePicker");
        this.densityPicker = document.getElementById("densityPicker");
        this.sidebarSettingsBtn = document.getElementById("sidebarSettingsBtn");
        this._settingsSnapshot = null;
        // Stats view
        this.statsView = document.getElementById("statsView");
        this.statsRangeLabel = document.getElementById("statsRangeLabel");
        this.statsPrevWeek = document.getElementById("statsPrevWeek");
        this.statsNextWeek = document.getElementById("statsNextWeek");
        this.statsTodayBtn = document.getElementById("statsTodayBtn");
        this.statsTotalTime = document.getElementById("statsTotalTime");
        this.statsTotalPomodoros = document.getElementById("statsTotalPomodoros");
        this.statsTotalSessions = document.getElementById("statsTotalSessions");
        this.statsChart = document.getElementById("statsChart");
        this.statsChartLegend = document.getElementById("statsChartLegend");
        this.statsByArea = document.getElementById("statsByArea");
        this.statsByProject = document.getElementById("statsByProject");
        this.statsByTask = document.getElementById("statsByTask");
        this.statsKindButtons = Array.from(document.querySelectorAll(".stats-kind-btn"));
        this.openPomodoroSettings = document.getElementById("openPomodoroSettings");
        // Pomodoro settings modal
        this.pomodoroSettingsModal = document.getElementById("pomodoroSettingsModal");
        this.pomodoroSettingsClose = document.getElementById("pomodoroSettingsClose");
        this.pomodoroSettingsCancel = document.getElementById("pomodoroSettingsCancel");
        this.pomodoroSettingsSave = document.getElementById("pomodoroSettingsSave");
        this.pomoFocusMinutes = document.getElementById("pomoFocusMinutes");
        this.pomoShortBreakMinutes = document.getElementById("pomoShortBreakMinutes");
        this.pomoLongBreakMinutes = document.getElementById("pomoLongBreakMinutes");
        this.pomoCyclesPerLongBreak = document.getElementById("pomoCyclesPerLongBreak");
        this.pomoAutoStartBreaks = document.getElementById("pomoAutoStartBreaks");
        this.pomoAutoStartFocus = document.getElementById("pomoAutoStartFocus");
        this.pomoSoundEnabled = document.getElementById("pomoSoundEnabled");
        // Date picker
        this.datePicker = document.getElementById("datePicker");
        this.dpTextInput = document.getElementById("dpTextInput");
        this.dpMonthLabel = document.getElementById("dpMonthLabel");
        this.dpGrid = document.getElementById("dpGrid");
        this.dpPrev = document.getElementById("dpPrev");
        this.dpNext = document.getElementById("dpNext");
        this.dpTodayBtn = document.getElementById("dpTodayBtn");
        this._dpTarget = null;
        this._dpTargetField = null;
        this._dpYear = new Date().getFullYear();
        this._dpMonth = new Date().getMonth();
    }

    bindEvents() {
        // Add task toggle
        this.addTaskToggle.addEventListener("click", () =>
            this.toggleAddTask()
        );

        // Add task modal close / cancel / overlay click
        if (this.addTaskModalClose) {
            this.addTaskModalClose.addEventListener("click", () => this.hideAddTask());
        }
        if (this.addTaskModalCancel) {
            this.addTaskModalCancel.addEventListener("click", () => this.hideAddTask());
        }
        if (this.addTaskModal) {
            this.addTaskModal.addEventListener("click", (event) => {
                if (event.target === this.addTaskModal) this.hideAddTask();
            });
        }

        // Add task submit
        this.addButton.addEventListener("click", () => this.addTodo());
        this.todoInput.addEventListener("keypress", (event) => {
            if (event.key === "Enter") {
                this.addTodo();
            }
        });

        // Sidebar navigation (only static todoNav items — areas/goals/projects are delegated)
        this.sidebarItems.forEach((item) => {
            item.addEventListener("click", (event) => {
                const addBtn = event.target.closest(".sidebar-item-add");
                if (addBtn && item.contains(addBtn)) {
                    event.stopPropagation();
                    event.preventDefault();
                    if (addBtn.dataset.addList) {
                        this.setView({ type: "list", value: addBtn.dataset.addList });
                    } else if (addBtn.dataset.addView) {
                        this.setView({ type: "view", value: addBtn.dataset.addView });
                    }
                    if (!this.addTaskVisible) this.toggleAddTask();
                    if (window.innerWidth <= 768) this.closeMobileSidebar();
                    return;
                }
                if (item.dataset.list) {
                    this.setView({
                        type: "list",
                        value: item.dataset.list,
                    });
                } else if (item.dataset.view) {
                    this.setView({
                        type: "view",
                        value: item.dataset.view,
                    });
                }
                if (window.innerWidth <= 768) this.closeMobileSidebar();
            });
        });

        // Settings modal: open via sidebar foot link; preview theme/density
        // on click; commit on Save; revert on Cancel/Close.
        if (this.sidebarSettingsBtn) {
            this.sidebarSettingsBtn.addEventListener("click", () => {
                this.openSettingsModal();
                if (window.innerWidth <= 768) this.closeMobileSidebar();
            });
        }
        if (this.themePicker) {
            this.themePicker.addEventListener("click", (event) => {
                const btn = event.target.closest("[data-theme]");
                if (!btn) return;
                this.applyTheme(btn.dataset.theme, false);
            });
        }
        if (this.densityPicker) {
            this.densityPicker.addEventListener("click", (event) => {
                const btn = event.target.closest("[data-density]");
                if (!btn) return;
                this.applyDensity(btn.dataset.density, false);
            });
        }
        if (this.settingsModalClose) {
            this.settingsModalClose.addEventListener("click", () => this.closeSettingsModal(true));
        }
        if (this.settingsModalCancel) {
            this.settingsModalCancel.addEventListener("click", () => this.closeSettingsModal(true));
        }
        if (this.settingsModalSave) {
            this.settingsModalSave.addEventListener("click", () => this.saveSettingsModal());
        }
        if (this.settingsModal) {
            this.settingsModal.addEventListener("click", (event) => {
                if (event.target === this.settingsModal) this.closeSettingsModal(true);
            });
        }
        // Restore persisted theme/density on load
        this.applyTheme(localStorage.getItem("gripTheme") || "ink", false);
        this.applyDensity(localStorage.getItem("gripDensity") || "cozy", false);
        this._todayMode = localStorage.getItem("gripTodayMode") === "list" ? "list" : "agenda";
        document.addEventListener("click", (event) => {
            const btn = event.target.closest("[data-td-mode]");
            if (!btn) return;
            this.setTodayMode(btn.dataset.tdMode);
        });

        // Clear completed
        if (this.clearCompletedButton) {
            this.clearCompletedButton.addEventListener("click", () =>
                this.clearCompleted()
            );
        }

        if (this.projectBackBtn) {
            this.projectBackBtn.addEventListener("click", () => this._handleKanbanBack());
        }

        // Project view (kanban) event delegation
        if (this.projectView) {
            this.projectView.addEventListener("click", (event) => {
                const back = event.target.closest("[data-kanban-back]");
                if (back) {
                    this._handleKanbanBack();
                    return;
                }
                const card = event.target.closest("[data-kanban-todo-id]");
                if (!card) return;
                const id = Number(card.dataset.kanbanTodoId);
                if (id) this.openModal(id);
            });
            this.projectView.addEventListener("keydown", (event) => {
                const card = event.target.closest("[data-kanban-todo-id]");
                if (!card) return;
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    const id = Number(card.dataset.kanbanTodoId);
                    if (id) this.openModal(id);
                }
            });
            this.projectView.addEventListener("dragstart", (event) => {
                const card = event.target.closest("[data-kanban-todo-id]");
                if (!card) return;
                const id = Number(card.dataset.kanbanTodoId);
                this._kanbanDragId = id;
                card.classList.add("is-dragging");
                if (event.dataTransfer) {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", String(id));
                }
            });
            this.projectView.addEventListener("dragend", (event) => {
                const card = event.target.closest("[data-kanban-todo-id]");
                if (card) card.classList.remove("is-dragging");
                this._clearKanbanDragHover();
                this._kanbanDragId = null;
            });
            this.projectView.addEventListener("dragover", (event) => {
                const dropzone = event.target.closest("[data-kanban-dropzone]");
                if (!dropzone) return;
                event.preventDefault();
                if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
                if (this._kanbanHoverEl !== dropzone) {
                    this._clearKanbanDragHover();
                    dropzone.classList.add("is-drop-target");
                    this._kanbanHoverEl = dropzone;
                }
            });
            this.projectView.addEventListener("dragleave", (event) => {
                const dropzone = event.target.closest("[data-kanban-dropzone]");
                if (!dropzone) return;
                if (event.relatedTarget && dropzone.contains(event.relatedTarget)) return;
                dropzone.classList.remove("is-drop-target");
                if (this._kanbanHoverEl === dropzone) this._kanbanHoverEl = null;
            });
            this.projectView.addEventListener("drop", (event) => {
                const dropzone = event.target.closest("[data-kanban-dropzone]");
                if (!dropzone) return;
                event.preventDefault();
                this._clearKanbanDragHover();
                let id = this._kanbanDragId;
                if (!id && event.dataTransfer) {
                    const raw = event.dataTransfer.getData("text/plain");
                    if (raw) id = Number(raw);
                }
                this._kanbanDragId = null;
                if (!id) return;
                const targetState = dropzone.dataset.kanbanDropzone;
                this._moveKanbanTodo(id, targetState);
            });
        }

        // Task list event delegation
        this.todoList.addEventListener("change", (event) => {
            if (event.target.classList.contains("todo-checkbox")) {
                const id = Number(event.target.dataset.id);
                this.toggleTodo(id);
                return;
            }
            if (event.target.classList.contains("set-date-input")) {
                const id = Number(event.target.dataset.id);
                const field = event.target.dataset.field;
                const value = event.target.value || null;
                this.closeAllMenus();
                this.setDateField(id, field, value);
                return;
            }
            if (event.target.classList.contains("set-duration-input")) {
                const id = Number(event.target.dataset.id);
                const value = event.target.value ? Number(event.target.value) : null;
                this.closeAllMenus();
                this.setDuration(id, value);
            }
        });

        this.todoList.addEventListener("click", (event) => {
            const dayHeader = event.target.closest(".week-day-header");
            if (dayHeader) {
                const day = dayHeader.dataset.day;
                if (day) {
                    if (this.collapsedWeekDays.has(day)) {
                        this.collapsedWeekDays.delete(day);
                    } else {
                        this.collapsedWeekDays.add(day);
                        if (this.weekAddDay === day) this.weekAddDay = null;
                    }
                    this.renderTodos();
                }
                return;
            }

            const addRow = event.target.closest(".week-day-add");
            if (addRow && !event.target.closest(".week-day-add-input")) {
                const day = addRow.dataset.day;
                if (day && this.weekAddDay !== day) {
                    this.weekAddDay = day;
                    this.renderTodos();
                }
                return;
            }

            const menuButton = event.target.closest(".menu-btn");
            if (menuButton) {
                event.stopPropagation();
                const item = menuButton.closest(".todo-item");
                if (item) {
                    this.toggleMenu(item, menuButton);
                }
                return;
            }

            const changeButton = event.target.closest(".change-list-btn");
            if (changeButton) {
                event.stopPropagation();
                const id = Number(changeButton.dataset.id);
                const targetList = changeButton.dataset.targetList;
                this.closeAllMenus();
                if (targetList) {
                    this.moveTodo(id, targetList);
                }
                return;
            }

            const areaButton = event.target.closest(".set-area-btn");
            if (areaButton) {
                event.stopPropagation();
                const id = Number(areaButton.dataset.id);
                const targetAreaRaw = areaButton.dataset.areaId || "";
                const targetAreaId = targetAreaRaw ? Number(targetAreaRaw) : null;
                this.closeAllMenus();
                this.setArea(id, targetAreaId);
                return;
            }

            const priorityButton = event.target.closest(".set-priority-btn");
            if (priorityButton) {
                event.stopPropagation();
                const id = Number(priorityButton.dataset.id);
                const targetPriority = priorityButton.dataset.priority;
                this.closeAllMenus();
                this.setPriority(id, targetPriority || "not_set");
                return;
            }

            const deleteButton = event.target.closest(".delete-btn");
            if (deleteButton) {
                event.stopPropagation();
                const id = Number(deleteButton.dataset.id);
                this.closeAllMenus();
                this.deleteTodo(id);
                return;
            }

            // Open detail modal when clicking on task content (not checkbox or actions)
            if (
                !event.target.closest(".todo-checkbox") &&
                !event.target.closest(".todo-actions")
            ) {
                const item = event.target.closest(".todo-item");
                if (item) {
                    const id = Number(item.dataset.id);
                    this.openModal(id);
                }
            }
        });

        this.todoList.addEventListener("keydown", (event) => {
            const addInput = event.target.closest(".week-day-add-input");
            if (!addInput) return;
            if (event.key === "Enter") {
                event.preventDefault();
                const day = addInput.dataset.day;
                const title = addInput.value;
                if (day && title.trim()) {
                    this.addTodoForDay(day, title);
                }
            } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                this.weekAddDay = null;
                this.renderTodos();
            }
        });

        // Close menus on outside click
        document.addEventListener("click", (event) => {
            if (
                !event.target.closest(".todo-actions") &&
                !event.target.closest(".project-menu-wrap")
            ) {
                this.closeAllMenus();
            }
        });

        // Escape to close menus, modals, and hide add-task modal
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                this.closeAllMenus();
                if (!this.taskModal.hidden) { this.closeModal(); return; }
                if (!this.addTaskModal.hidden) { this.hideAddTask(); return; }
            }
        });

        // Modal close / delete
        this.modalCloseBtn.addEventListener("click", () => this.closeModal());
        this.modalDeleteBtn.addEventListener("click", () => {
            if (this.openTodoId) {
                this.deleteTodo(this.openTodoId);
                this.closeModal();
            }
        });

        // Click outside modal content closes it
        this.taskModal.addEventListener("click", (event) => {
            if (event.target === this.taskModal) this.closeModal();
        });

        // Modal checkbox
        this.modalCheckbox.addEventListener("change", () => {
            if (this.openTodoId) this.toggleTodo(this.openTodoId);
        });

        // Modal title auto-save on blur + textarea auto-resize
        this.modalTitleInput.addEventListener("blur", () => this.saveModalTitle());
        this.modalTitleInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") { event.preventDefault(); this.modalTitleInput.blur(); }
        });
        this.modalTitleInput.addEventListener("input", () => this._autoResizeTextarea(this.modalTitleInput));

        // Modal field auto-save on change + immediate visual state sync
        // (date fields are handled by the custom date picker, not change events)
        [
            { el: this.modalState,       field: "state" },
            { el: this.modalList,        field: "list" },
            { el: this.modalDuration,    field: "duration" },
            { el: this.modalPlannedTime, field: "planned_time" },
            { el: this.modalPriority,    field: "priority" },
            { el: this.modalArea,        field: "area" },
            { el: this.modalProject,     field: "project" },
        ].forEach(({ el, field }) => {
            if (!el) return;
            el.addEventListener("change", () => {
                this._syncModalFieldStates();
                if (field === "area") this._syncModalAreaSwatch();
                this.saveModalField(field, el.value);
            });
            // Remove is-editing on blur if still unset
            el.addEventListener("blur", () => {
                const fieldEl = el.closest(".modal-field");
                if (fieldEl && !fieldEl.classList.contains("is-set")) {
                    fieldEl.classList.remove("is-editing");
                }
            });
        });

        // Calendar subscription modal
        if (this.addCalendarBtn) {
            this.addCalendarBtn.addEventListener("click", () => this.openCalendarModal());
        }
        if (this.calendarModal) {
            this.calendarModalCloseBtn.addEventListener("click", () => this.closeCalendarModal());
            this.calendarModalCancel.addEventListener("click", () => this.closeCalendarModal());
            this.calendarModal.addEventListener("click", (event) => {
                if (event.target === this.calendarModal) this.closeCalendarModal();
            });
            this.calendarModalSave.addEventListener("click", () => this.saveCalendarSubscription());
        }
        if (this.calendarAreaSelect) {
            this.calendarAreaSelect.addEventListener("change", () => {
                this._updateCalendarColorVisibility();
            });
        }
        if (this.calendarNav) {
            this.calendarNav.addEventListener("click", (event) => {
                const delBtn = event.target.closest(".calendar-sub-delete");
                if (delBtn) {
                    event.stopPropagation();
                    const id = Number(delBtn.dataset.id);
                    if (confirm("Agenda verwijderen?")) this.deleteCalendarSubscription(id);
                    return;
                }
                const syncBtn = event.target.closest(".calendar-sub-sync");
                if (syncBtn) {
                    event.stopPropagation();
                    this.syncCalendarSubscription(Number(syncBtn.dataset.id));
                    return;
                }
                const editBtn = event.target.closest(".calendar-sub-edit");
                const item = event.target.closest(".calendar-sub-item");
                if (editBtn || item) {
                    event.stopPropagation();
                    const id = Number((editBtn || item).dataset.id);
                    if (id) this.openCalendarModal(id);
                }
            });
        }
        // Today header action buttons
        if (this.todayNewTaskBtn) {
            this.todayNewTaskBtn.addEventListener("click", () => this.toggleAddTask());
        }
        if (this.todayFocusBtn) {
            this.todayFocusBtn.addEventListener("click", () => {
                if (this.activeSession) {
                    if (this.activeSession.task_id) this.openModal(Number(this.activeSession.task_id));
                    return;
                }
                // No active session — pick first incomplete today task as focus target.
                const target = this.todos.find((t) => !t.completed && this._isTodoForToday(t));
                if (target) this.startPomodoro(target.id);
                else this.setStatus("Geen taken voor vandaag om mee te starten");
            });
        }
        if (this.todayBellBtn) {
            this.todayBellBtn.addEventListener("click", () => this.setStatus("Geen nieuwe meldingen"));
        }
        // Next-week header week stepper
        if (this.nextWeekPrevBtn) {
            this.nextWeekPrevBtn.addEventListener("click", () => {
                if (this.nextWeekOffset <= 0) return;
                this.nextWeekOffset -= 1;
                this.renderNextWeekView();
            });
        }
        if (this.nextWeekNextBtn) {
            this.nextWeekNextBtn.addEventListener("click", () => {
                this.nextWeekOffset += 1;
                this.renderNextWeekView();
            });
        }
        const nwPlan = document.getElementById("nextWeekPlanBtn");
        if (nwPlan) {
            nwPlan.addEventListener("click", () => this.openPlanWeekModal());
        }
        if (this.planWeekClose) {
            this.planWeekClose.addEventListener("click", () => this.closePlanWeekModal());
        }
        if (this.planWeekModal) {
            this.planWeekModal.addEventListener("click", (e) => {
                if (e.target === this.planWeekModal) this.closePlanWeekModal();
            });
        }
        if (this.planWeekSave) {
            this.planWeekSave.addEventListener("click", () => this.savePlanWeekModal());
        }
        if (this.nextWeekDeadlinesList) {
            const openFromRow = (row) => {
                const id = Number(row.dataset.todoId);
                if (id) this.openModal(id);
            };
            this.nextWeekDeadlinesList.addEventListener("click", (e) => {
                const row = e.target.closest(".dl-row[data-todo-id]");
                if (row) openFromRow(row);
            });
            this.nextWeekDeadlinesList.addEventListener("keydown", (e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                const row = e.target.closest(".dl-row[data-todo-id]");
                if (!row) return;
                e.preventDefault();
                openFromRow(row);
            });
        }
        if (this.todayTasks) {
            this.todayTasks.addEventListener("click", (e) => this._onTodayTaskClick(e));
        }
        // Tab pill (visual-only for now)
        const todayTabPill = this.todayTasks?.closest(".today-tasks-panel")?.querySelector(".tab-pill");
        if (todayTabPill) {
            todayTabPill.addEventListener("click", (e) => {
                const btn = e.target.closest("button");
                if (!btn) return;
                todayTabPill.querySelectorAll("button").forEach((b) => b.classList.remove("on"));
                btn.classList.add("on");
            });
        }

        // Focus widget actions
        if (this.focusPauseBtn) {
            this.focusPauseBtn.addEventListener("click", () => this.skipPomodoroPhase());
        }
        if (this.focusStopBtn) {
            this.focusStopBtn.addEventListener("click", () => this.stopActiveTimer());
        }

        // Sidebar search → modal
        if (this.sidebarSearchBtn) {
            this.sidebarSearchBtn.addEventListener("click", () => this.openSearchModal());
        }
        if (this.searchModal) {
            this.searchModal.addEventListener("click", (e) => {
                if (e.target === this.searchModal) this.closeSearchModal();
            });
        }
        if (this.searchModalInput) {
            this.searchModalInput.addEventListener("input", () => this._renderSearchResults());
            this.searchModalInput.addEventListener("keydown", (e) => this._onSearchKey(e));
        }
        if (this.searchResults) {
            this.searchResults.addEventListener("click", (e) => {
                const item = e.target.closest(".search-result-item");
                if (!item) return;
                const idx = Number(item.dataset.idx);
                this._activateSearchHit(idx);
            });
            this.searchResults.addEventListener("mouseover", (e) => {
                const item = e.target.closest(".search-result-item");
                if (!item) return;
                const idx = Number(item.dataset.idx);
                if (Number.isFinite(idx)) this._setSearchActive(idx);
            });
        }
        document.addEventListener("keydown", (e) => {
            const isCmdK = (e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K");
            if (isCmdK) {
                e.preventDefault();
                this.openSearchModal();
                return;
            }
            if (e.key === "Escape" && this.searchModal && !this.searchModal.hidden) {
                this.closeSearchModal();
            }
        });

        // Date picker internal events
        if (this.datePicker) {
            this.dpPrev.addEventListener("click", () => {
                this._dpMonth--;
                if (this._dpMonth < 0) { this._dpMonth = 11; this._dpYear--; }
                this._renderDpCalendar();
            });
            this.dpNext.addEventListener("click", () => {
                this._dpMonth++;
                if (this._dpMonth > 11) { this._dpMonth = 0; this._dpYear++; }
                this._renderDpCalendar();
            });
            this.dpTodayBtn.addEventListener("click", () => {
                const t = new Date();
                this._dpYear = t.getFullYear();
                this._dpMonth = t.getMonth();
                this._renderDpCalendar();
            });
            this.datePicker.querySelectorAll(".dp-quick-btn").forEach((btn) => {
                btn.addEventListener("click", () => {
                    const d = new Date();
                    d.setDate(d.getDate() + Number(btn.dataset.days));
                    this._dpCommitDate(d.toISOString().split("T")[0]);
                });
            });
            this.dpGrid.addEventListener("click", (e) => {
                const cell = e.target.closest(".dp-day[data-date]");
                if (cell) this._dpCommitDate(cell.dataset.date);
            });
            this.dpTextInput.addEventListener("input", () => {
                const m = this.dpTextInput.value.match(/^(\d{2})-(\d{2})-(\d{4})$/);
                if (m) {
                    const dateStr = `${m[3]}-${m[2]}-${m[1]}`;
                    const d = new Date(dateStr);
                    if (!isNaN(d.getTime())) {
                        this._dpYear = d.getFullYear();
                        this._dpMonth = d.getMonth();
                        this._renderDpCalendar();
                        this._dpCommitDate(dateStr);
                    }
                }
            });
            // Close picker when clicking outside
            document.addEventListener("click", (e) => {
                if (!this.datePicker.hidden &&
                    !this.datePicker.contains(e.target) &&
                    !e.target.closest(".modal-date-btn")) {
                    this.closeDatePicker();
                }
            });
        }

        // Click on a modal field: open date picker for date fields, reveal input for others
        this.taskModal.addEventListener("click", (event) => {
            if (event.target === this.taskModal) return;
            const field = event.target.closest(".modal-field");
            if (!field) return;

            // Date field: open custom picker regardless of is-set state
            const dateInput = field.querySelector(".modal-date-btn");
            if (dateInput) {
                event.stopPropagation();
                this._openModalDatePicker(dateInput);
                return;
            }

            if (field.classList.contains("is-set") || field.classList.contains("is-editing")) return;
            field.classList.add("is-editing");
            const input = field.querySelector("input.modal-field-input");
            if (input) {
                input.focus();
                input.showPicker?.();
            }
        });

        // Add-form recurrence: show/hide interval + end when unit changes
        if (this.recurrenceUnit) {
            this.recurrenceUnit.addEventListener("change", () => {
                const hasUnit = !!this.recurrenceUnit.value;
                this.recurrenceInterval.hidden = !hasUnit;
                this.recurrenceEndLabel.hidden = !hasUnit;
                this.recurrenceEnd.hidden = !hasUnit;
                if (!hasUnit) {
                    this.recurrenceInterval.value = "1";
                    this.recurrenceEnd.value = "";
                }
            });
        }

        // Modal recurrence unit: show/hide interval + end
        if (this.modalRecurrenceUnit) {
            this.modalRecurrenceUnit.addEventListener("change", () => {
                this._syncModalRecurrenceVisibility();
                this._saveModalRecurrence();
            });
            this.modalRecurrenceInterval.addEventListener("change", () => {
                this._saveModalRecurrence();
            });
            this.modalRecurrenceEnd.addEventListener("change", () => {
                this._saveModalRecurrence();
            });
        }

        // Archive project button
        if (this.archiveProjectBtn) {
            this.archiveProjectBtn.addEventListener("click", () => this.archiveProject());
        }
        if (this.reviveProjectBtn) {
            this.reviveProjectBtn.addEventListener("click", () => this.reviveProject());
        }
        if (this.projectMenuBtn) {
            this.projectMenuBtn.addEventListener("click", (event) => {
                event.stopPropagation();
                this._toggleProjectMenu();
            });
        }
        if (this.projectMenu) {
            this.projectMenu.addEventListener("click", (event) => {
                const item = event.target.closest("[data-project-action]");
                if (!item) return;
                event.stopPropagation();
                const action = item.dataset.projectAction;
                this._closeProjectMenu();
                if (action === "rename") {
                    this._renameCurrentProject();
                } else if (action === "toggle-today") {
                    this.toggleProjectOnToday();
                } else if (action === "delete") {
                    this._deleteCurrentProject();
                }
            });
        }

        // Area tree delegation: expand/collapse, selection, add buttons
        if (this.areaNav) {
            this.areaNav.addEventListener("click", (e) => {
                const toggle = e.target.closest(".tree-toggle");
                if (toggle) {
                    e.stopPropagation();
                    const kind = toggle.dataset.kind;
                    const id = Number(toggle.dataset.id);
                    if (kind === "area") {
                        if (this.expandedAreaIds.has(id)) this.expandedAreaIds.delete(id);
                        else this.expandedAreaIds.add(id);
                    } else if (kind === "goal") {
                        if (this.expandedGoalIds.has(id)) this.expandedGoalIds.delete(id);
                        else this.expandedGoalIds.add(id);
                    }
                    this.renderAreaTree();
                    return;
                }
                const editArea = e.target.closest(".edit-area-btn");
                if (editArea) {
                    e.stopPropagation();
                    const areaId = Number(editArea.dataset.areaId);
                    const area = this.areas.find((a) => a.id === areaId);
                    if (area) this.openAreaModal(area);
                    return;
                }
                const addGoal = e.target.closest(".add-goal-btn");
                if (addGoal) {
                    e.stopPropagation();
                    this.openGoalModal({ area_id: Number(addGoal.dataset.areaId) });
                    return;
                }
                const addProject = e.target.closest(".add-project-btn");
                if (addProject) {
                    e.stopPropagation();
                    const areaId = addProject.dataset.areaId ? Number(addProject.dataset.areaId) : null;
                    const goalId = addProject.dataset.goalId ? Number(addProject.dataset.goalId) : null;
                    this.createProject({ areaId, goalId });
                    return;
                }
                const item = e.target.closest("[data-tree-node]");
                if (!item) return;
                const kind = item.dataset.treeNode;
                const id = Number(item.dataset.id);
                if (kind === "area") {
                    this.setView({ type: "area", value: id });
                } else if (kind === "goal") {
                    this.setView({ type: "goal", value: id });
                } else if (kind === "project") {
                    this.setView({ type: "project", value: id });
                }
                if (window.innerWidth <= 768) this.closeMobileSidebar();
            });
        }

        // Area add button (header +)
        if (this.addAreaBtn) {
            this.addAreaBtn.addEventListener("click", () => this.openAreaModal());
        }

        // Area modal bindings
        if (this.areaModal) {
            this.areaModalCloseBtn.addEventListener("click", () => this.closeAreaModal());
            this.areaModalCancel.addEventListener("click", () => this.closeAreaModal());
            this.areaModalSave.addEventListener("click", () => this.saveAreaModal());
            this.areaModal.addEventListener("click", (e) => {
                if (e.target === this.areaModal) this.closeAreaModal();
            });
        }

        // Goal modal bindings
        if (this.goalModal) {
            this.goalModalCloseBtn.addEventListener("click", () => this.closeGoalModal());
            this.goalModalCancel.addEventListener("click", () => this.closeGoalModal());
            this.goalModalSave.addEventListener("click", () => this.saveGoalModal());
            this.goalModal.addEventListener("click", (e) => {
                if (e.target === this.goalModal) this.closeGoalModal();
            });
        }

        // Project sidebar navigation (event delegation for dynamic items)
        if (this.projectNav) {
            this.projectNav.addEventListener("click", (e) => {
                const item = e.target.closest("[data-project-filter]");
                if (item) {
                    this.setView({ type: "project", value: Number(item.dataset.projectFilter) });
                    if (window.innerWidth <= 768) this.closeMobileSidebar();
                }
            });
        }

        // Add project button / inline form
        if (this.addProjectBtn) {
            this.addProjectBtn.addEventListener("click", () => {
                this.newProjectForm.hidden = false;
                this.newProjectInput.focus();
            });
        }
        if (this.newProjectInput) {
            this.newProjectInput.addEventListener("keydown", (e) => {
                if (e.key === "Enter") {
                    this.createProject(this.newProjectInput.value.trim());
                } else if (e.key === "Escape") {
                    this.newProjectForm.hidden = true;
                    this.newProjectInput.value = "";
                }
            });
            this.newProjectInput.addEventListener("blur", () => {
                const name = this.newProjectInput.value.trim();
                if (!this.newProjectForm.hidden && name) {
                    this.createProject(name);
                } else if (!this.newProjectForm.hidden) {
                    this.newProjectForm.hidden = true;
                }
            });
        }

        // Collapsible sidebar sections
        document.querySelectorAll(".sidebar-section-toggle").forEach((btn) => {
            btn.addEventListener("click", () => {
                const navId = btn.dataset.toggleSection;
                const nav = document.getElementById(navId);
                if (!nav) return;
                const expanded = btn.getAttribute("aria-expanded") === "true";
                btn.setAttribute("aria-expanded", String(!expanded));
                nav.classList.toggle("collapsed", expanded);
            });
        });

        // Mobile sidebar toggle & swipe
        if (this.mobileMenuBtn) {
            this.mobileMenuBtn.addEventListener("click", () => this.openMobileSidebar());
        }
        if (this.sidebarOverlay) {
            this.sidebarOverlay.addEventListener("click", () => this.closeMobileSidebar());
        }
        this._initSwipeGesture();

        // ── Timer pill ──────────────────────────────────────────────────
        if (this.timerPillBody) {
            this.timerPillBody.addEventListener("click", () => {
                if (this.activeSession?.task_id) {
                    this.openModal(Number(this.activeSession.task_id));
                }
            });
        }
        if (this.timerPillStop) {
            this.timerPillStop.addEventListener("click", (e) => {
                e.stopPropagation();
                this.stopActiveTimer();
            });
        }
        if (this.timerPillSkip) {
            this.timerPillSkip.addEventListener("click", (e) => {
                e.stopPropagation();
                this.skipPomodoroPhase();
            });
        }

        // ── Modal Tijd actions ──────────────────────────────────────────
        if (this.modalStartPomodoro) {
            this.modalStartPomodoro.addEventListener("click", () => {
                if (this.openTodoId) this.startPomodoro(this.openTodoId);
            });
        }
        if (this.modalPauseTimer) {
            this.modalPauseTimer.addEventListener("click", () => this.skipPomodoroPhase());
        }
        if (this.modalStopTimer) {
            this.modalStopTimer.addEventListener("click", () => this.stopActiveTimer());
        }

        // ── Stats view controls ─────────────────────────────────────────
        if (this.statsPrevWeek) {
            this.statsPrevWeek.addEventListener("click", () => {
                this.statsRangeOffset -= 1;
                this.renderStats();
            });
        }
        if (this.statsNextWeek) {
            this.statsNextWeek.addEventListener("click", () => {
                this.statsRangeOffset += 1;
                this.renderStats();
            });
        }
        if (this.statsTodayBtn) {
            this.statsTodayBtn.addEventListener("click", () => {
                this.statsRangeOffset = 0;
                this.renderStats();
            });
        }
        this.statsKindButtons.forEach((btn) => {
            btn.addEventListener("click", () => {
                this.statsKindFilter = btn.dataset.kind || "all";
                this.statsKindButtons.forEach((b) =>
                    b.classList.toggle("is-active", b === btn)
                );
                this.renderStats();
            });
        });

        // ── Pomodoro settings modal ─────────────────────────────────────
        if (this.openPomodoroSettings) {
            this.openPomodoroSettings.addEventListener("click", () => this.openPomodoroSettingsModal());
        }
        if (this.pomodoroSettingsClose) {
            this.pomodoroSettingsClose.addEventListener("click", () => this.closePomodoroSettingsModal());
        }
        if (this.pomodoroSettingsCancel) {
            this.pomodoroSettingsCancel.addEventListener("click", () => this.closePomodoroSettingsModal());
        }
        if (this.pomodoroSettingsModal) {
            this.pomodoroSettingsModal.addEventListener("click", (e) => {
                if (e.target === this.pomodoroSettingsModal) this.closePomodoroSettingsModal();
            });
        }
        if (this.pomodoroSettingsSave) {
            this.pomodoroSettingsSave.addEventListener("click", () => this.savePomodoroSettings());
        }
    }

    // --- Add task toggle ---

    toggleAddTask() {
        if (this.addTaskVisible) {
            this.hideAddTask();
        } else {
            this.addTaskVisible = true;
            this.addTaskModal.hidden = false;
            if (this.projectSelect && this.currentView.type === "project") {
                this.projectSelect.value = String(this.currentView.value);
            }
            this.todoInput.focus();
        }
    }

    hideAddTask() {
        this.addTaskVisible = false;
        this.addTaskModal.hidden = true;
    }

    // --- Mobile sidebar ---

    openMobileSidebar() {
        this.sidebar.classList.add("mobile-open");
        this.sidebarOverlay.classList.add("visible");
        document.body.style.overflow = "hidden";
    }

    closeMobileSidebar() {
        this.sidebar.classList.remove("mobile-open");
        this.sidebarOverlay.classList.remove("visible");
        document.body.style.overflow = "";
    }

    _initSwipeGesture() {
        let touchStartX = 0;
        let touchStartY = 0;

        document.addEventListener("touchstart", (e) => {
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
        }, { passive: true });

        document.addEventListener("touchend", (e) => {
            const dx = e.changedTouches[0].clientX - touchStartX;
            const dy = Math.abs(e.changedTouches[0].clientY - touchStartY);

            // Swipe right from left edge to open
            if (touchStartX < 30 && dx > 50 && dy < 100) {
                this.openMobileSidebar();
            }
            // Swipe left to close
            if (this.sidebar.classList.contains("mobile-open") && dx < -50 && dy < 100) {
                this.closeMobileSidebar();
            }
        }, { passive: true });
    }

    // --- View management ---

    setView(view) {
        this.currentView = view;

        // Update sidebar active state (includes dynamically rendered project items)
        document.querySelectorAll(".sidebar-item").forEach((item) => {
            let isActive = false;
            if (view.type === "list" && item.dataset.list === view.value)
                isActive = true;
            if (view.type === "view" && item.dataset.view === view.value)
                isActive = true;
            if (view.type === "project" && Number(item.dataset.projectFilter) === view.value)
                isActive = true;
            item.classList.toggle("active", isActive);
            item.setAttribute("aria-pressed", isActive.toString());
        });

        // Area tree nodes (area, goal, project-in-area)
        document.querySelectorAll("[data-tree-node]").forEach((node) => {
            const kind = node.dataset.treeNode;
            const id = Number(node.dataset.id);
            const isActive = view.type === kind && view.value === id;
            node.classList.toggle("active", isActive);
            node.setAttribute("aria-pressed", isActive.toString());
        });

        // Update header title
        this.activeListLabel.textContent = this.getViewLabel();

        // Show archive/revive button depending on the project's state
        if (this.projectActionsEl) {
            const isProject = view.type === "project";
            const isActiveProject = isProject &&
                this.projects.some(p => p.id === view.value && (p.status === undefined || p.status === "active"));
            const isCompletedProject = view.type === "project" &&
                this.completedProjects.some(p => p.id === view.value);
            this.projectActionsEl.hidden = !(isActiveProject || isCompletedProject);
            if (this.archiveProjectBtn) this.archiveProjectBtn.hidden = !isActiveProject;
            if (this.reviveProjectBtn) this.reviveProjectBtn.hidden = !isCompletedProject;
            if (this.projectMenuWrap) {
                this.projectMenuWrap.hidden = !isActiveProject;
                if (!isActiveProject) this.projectMenuWrap.classList.remove("menu-open");
                if (isActiveProject) this._renderProjectMenuFavState(view.value);
            }
        }
        // Hide the "add task" affordance for archived projects
        if (this.addTaskToggle) {
            const isCompletedProjectView = view.type === "project" &&
                this.completedProjects.some(p => p.id === view.value);
            this.addTaskToggle.hidden = isCompletedProjectView;
            if (isCompletedProjectView) this.hideAddTask();
        }

        this._applyCalendarChrome();

        const isToday = this._isTodayView();
        const isStats = view.type === "view" && view.value === "stats";
        const isProject = this._isProjectView();
        const isNextWeek = view.type === "view" && view.value === "next-week";

        // Toggle between today view, stats view, project view, next-week view,
        // and regular task list.
        if (this.statsView) this.statsView.hidden = !isStats;
        if (this.todayView) this.todayView.hidden = !isToday;
        if (this.projectView) this.projectView.hidden = !isProject;
        if (this.nextWeekView) this.nextWeekView.hidden = !isNextWeek;
        if (this.todoList) this.todoList.hidden = isStats || isToday || isProject || isNextWeek;

        // Project view shows the back button in the top-left and moves the
        // project name into the project header card body.
        if (this.projectBackBtn) this.projectBackBtn.hidden = !isProject;
        if (this.contentTitleBlock) this.contentTitleBlock.hidden = isProject;
        if (this.itemCount) this.itemCount.hidden = isProject || isToday || isNextWeek;

        // Show the next-week header tools alongside the existing content header.
        if (this.nextWeekHeaderTools) this.nextWeekHeaderTools.hidden = !isNextWeek;
        if (!isNextWeek) {
            const sub = document.getElementById("contentSubtitle");
            if (sub) sub.textContent = "";
        }

        if (isStats) {
            if (this.addTaskToggle) {
                this.addTaskToggle.hidden = true;
                this.hideAddTask();
            }
            if (this.itemCount) this.itemCount.textContent = "";
            this.renderStats();
            return;
        }

        if (isToday) {
            // Hide the FAB on today view; the header has its own "Nieuwe taak" button.
            if (this.addTaskToggle) {
                this.addTaskToggle.hidden = true;
                this.hideAddTask();
            }
            this.renderTodayView();
            this.refreshTodayAgenda();
            return;
        }

        if (isProject) {
            this.renderProjectView();
            this.updateItemCount();
            this.updateSidebarCounts();
            return;
        }

        if (isNextWeek) {
            if (this.addTaskToggle) {
                this.addTaskToggle.hidden = true;
                this.hideAddTask();
            }
            this.renderNextWeekView();
            this.updateSidebarCounts();
            return;
        }

        this.renderTodos();
        if (view.type === "view" && view.value === "week") {
            const range = this.getWeekRange(0);
            this.loadCalendarEvents(range.start, range.end).then(() =>
                this.renderTodos()
            );
        }
    }

    _isTodayView() {
        return this.currentView.type === "list" && this.currentView.value === "today";
    }

    _isProjectView() {
        return this.currentView.type === "project";
    }

    _applyCalendarChrome() {
        const isToday = this._isTodayView();
        if (this.todayHeaderTools) this.todayHeaderTools.hidden = !isToday;
    }

    applyTheme(theme, persist) {
        const allowed = ["ink", "forest", "plum", "ochre"];
        const value = allowed.includes(theme) ? theme : "ink";
        if (value === "ink") {
            document.body.removeAttribute("data-theme");
        } else {
            document.body.setAttribute("data-theme", value);
        }
        if (persist) {
            localStorage.setItem("gripTheme", value);
        }
        if (this.themePicker) {
            this.themePicker.querySelectorAll("[data-theme]").forEach((btn) => {
                const isActive = btn.dataset.theme === value;
                btn.classList.toggle("is-active", isActive);
                btn.setAttribute("aria-checked", isActive ? "true" : "false");
            });
        }
    }

    applyDensity(density, persist) {
        const allowed = ["compact", "cozy", "roomy"];
        const value = allowed.includes(density) ? density : "cozy";
        document.body.setAttribute("data-density", value);
        if (persist) {
            localStorage.setItem("gripDensity", value);
        }
        if (this.densityPicker) {
            this.densityPicker.querySelectorAll("[data-density]").forEach((btn) => {
                const isActive = btn.dataset.density === value;
                btn.classList.toggle("is-active", isActive);
                btn.setAttribute("aria-checked", isActive ? "true" : "false");
            });
        }
    }

    openSettingsModal() {
        if (!this.settingsModal) return;
        // Snapshot current persisted theme/density so Cancel can revert.
        this._settingsSnapshot = {
            theme: localStorage.getItem("gripTheme") || "ink",
            density: localStorage.getItem("gripDensity") || "cozy",
        };
        // Sync the picker UI to the current state.
        this.applyTheme(this._settingsSnapshot.theme, false);
        this.applyDensity(this._settingsSnapshot.density, false);
        // Render the calendar list inside the modal.
        if (typeof this.renderCalendarSidebar === "function") {
            this.renderCalendarSidebar();
        }
        this.settingsModal.hidden = false;
    }

    closeSettingsModal(revert) {
        if (!this.settingsModal) return;
        if (revert && this._settingsSnapshot) {
            // Roll back any preview changes to the persisted snapshot.
            this.applyTheme(this._settingsSnapshot.theme, false);
            this.applyDensity(this._settingsSnapshot.density, false);
        }
        this._settingsSnapshot = null;
        this.settingsModal.hidden = true;
    }

    saveSettingsModal() {
        // Read whichever theme/density is currently previewed and persist it.
        const theme = document.body.getAttribute("data-theme") || "ink";
        const density = document.body.getAttribute("data-density") || "cozy";
        localStorage.setItem("gripTheme", theme);
        localStorage.setItem("gripDensity", density);
        this._settingsSnapshot = null;
        if (this.settingsModal) this.settingsModal.hidden = true;
        this.setStatus("Instellingen opgeslagen");
    }

    getViewLabel() {
        switch (this.currentView.type) {
            case "list":
                return this.currentView.value === "inbox"
                    ? "Inbox"
                    : "Vandaag";
            case "view":
                if (this.currentView.value === "all") return "Alle taken";
                if (this.currentView.value === "week") return "Deze week";
                if (this.currentView.value === "next-week") return "Volgende week";
                if (this.currentView.value === "waiting") return "Wachten op";
                if (this.currentView.value === "stats") return "Inzichten";
                return "Voltooid";
            case "area": {
                const area = this.getAreaById(this.currentView.value);
                return area ? area.name : "Gebied";
            }
            case "goal": {
                const goal = this.getGoalById(this.currentView.value);
                return goal ? goal.name : "Doel";
            }
            case "project": {
                const project = this.projects.find(p => p.id === this.currentView.value)
                    || this.completedProjects.find(p => p.id === this.currentView.value);
                return project ? project.name : "Project";
            }
            default:
                return "Inbox";
        }
    }

    // --- Normalization ---

    normalizeListName(listName) {
        if (!listName) {
            return null;
        }
        const normalized = listName.toString().trim().toLowerCase();
        if (!this.availableLists.includes(normalized)) {
            return null;
        }
        return normalized;
    }

    getAreaById(areaId) {
        if (areaId === null || areaId === undefined) return null;
        const id = Number(areaId);
        return this.areas.find((a) => a.id === id) || null;
    }

    getGoalById(goalId) {
        if (goalId === null || goalId === undefined) return null;
        const id = Number(goalId);
        return this.goals.find((g) => g.id === id) || null;
    }

    // Returns the area_id associated with a task: direct task.area_id,
    // or resolved via project → goal → area for project-linked tasks.
    resolveTaskAreaId(task) {
        if (task.area_id) return task.area_id;
        if (task.project_id) {
            const project = this.projects.find((p) => p.id === task.project_id);
            if (project && project.area_id) return project.area_id;
        }
        return null;
    }

    normalizePriority(priority) {
        if (priority === null || priority === undefined) {
            return "not_set";
        }
        const normalized = priority
            .toString()
            .trim()
            .toLowerCase()
            .replace(/\s+/g, "_");
        if (!normalized) {
            return "not_set";
        }
        if (!this.availablePriorities.includes(normalized)) {
            return "not_set";
        }
        return normalized;
    }

    normalizeTodo(todo) {
        // A task is in a list XOR a project. Keep list=null for project tasks;
        // only default to "inbox" for unparented tasks with a stray null list.
        const normalizedList = todo.project_id
            ? null
            : this.normalizeListName(todo.list) || this.availableLists[0];
        const normalizedPriority = this.normalizePriority(todo.priority);
        return {
            ...todo,
            list: normalizedList,
            area_id: todo.area_id ?? null,
            priority: normalizedPriority,
            state: todo.state || "to_do",
        };
    }

    getListLabel(listName) {
        const normalized =
            this.normalizeListName(listName) || this.availableLists[0];
        return normalized === "inbox" ? "Inbox" : "Vandaag";
    }

    getAreaLabel(areaId) {
        const area = this.getAreaById(areaId);
        return area ? area.name : "";
    }

    getAreaColor(areaId) {
        const area = this.getAreaById(areaId);
        return area ? area.color : "#888";
    }

    getProjectLabel(projectId) {
        if (!projectId) return "";
        const project = this.projects.find(p => p.id === projectId);
        return project ? project.name : "";
    }

    getStateLabel(state) {
        const labels = {
            to_do: "Te doen",
            in_progress: "Bezig",
            done: "Afgerond",
            waiting: "Wachten op",
            someday: "Ooit | Misschien",
        };
        return labels[state] || "Te doen";
    }

    getPriorityLabel(priority) {
        const normalized = this.normalizePriority(priority);
        switch (normalized) {
            case "low":
                return "Laag";
            case "medium":
                return "Gemiddeld";
            case "high":
                return "Hoog";
            default:
                return "Niet ingesteld";
        }
    }

    // --- API ---

    async request(url, options = {}) {
        const response = await fetch(url, {
            headers: {
                "Content-Type": "application/json",
            },
            credentials: "same-origin",
            ...options,
        });

        if (response.status === 401) {
            window.location.href = "/login";
            return {};
        }

        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            const message = errorBody.detail || "Something went wrong.";
            throw new Error(message);
        }

        return response.json();
    }

    setStatus(message, options = {}) {
        if (!this.statusMessage) {
            return;
        }
        if (this._statusTimer) {
            clearTimeout(this._statusTimer);
            this._statusTimer = null;
        }
        this.statusMessage.textContent = message;
        if (message) {
            this.statusMessage.classList.add("visible");
            const duration = options.duration ?? 3000;
            if (duration > 0) {
                this._statusTimer = setTimeout(() => {
                    this.statusMessage.textContent = "";
                    this.statusMessage.classList.remove("visible");
                    this._statusTimer = null;
                }, duration);
            }
        } else {
            this.statusMessage.classList.remove("visible");
        }
    }

    async loadTodos() {
        try {
            const data = await this.request("/api/todos");
            this.todos = (data.todos || []).map((todo) =>
                this.normalizeTodo(todo)
            );
            this.renderTodos();
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    async loadProjects() {
        try {
            const data = await this.request("/api/projects");
            this.projects = data.projects || [];
            this.renderProjectsSidebar();
            this.renderAreaTree();
            this._populateProjectSelects();
            await this._migrateLegacyTodayProjects();
        } catch (_) {
            // Projects failing shouldn't block the app
        }
    }

    async loadCompletedProjects() {
        try {
            const data = await this.request("/api/projects/completed");
            this.completedProjects = data.projects || [];
            this.renderProjectsSidebar();
        } catch (_) {
            // Completed projects failing shouldn't block the app
        }
    }

    async loadAreas() {
        try {
            const data = await this.request("/api/areas");
            this.areas = data.areas || [];
            // Default: expand all active areas on first load.
            if (this.expandedAreaIds.size === 0) {
                this.areas
                    .filter((a) => a.status === "active")
                    .forEach((a) => this.expandedAreaIds.add(a.id));
            }
        } catch (_) {
            // Areas failing shouldn't block the app
        }
    }

    async loadGoals() {
        try {
            const data = await this.request("/api/goals");
            this.goals = data.goals || [];
        } catch (_) {
            // Goals failing shouldn't block the app
        }
    }

    // --- Area tree rendering ---

    renderAreaTree() {
        if (!this.areaNav) return;

        const activeAreas = this.areas.filter((a) => a.status === "active");
        const archivedAreas = this.areas.filter((a) => a.status === "archived");
        const activeProjects = this.projects.filter(
            (p) => p.status === undefined || p.status === "active"
        );

        const renderArea = (area, extraClass = "") => {
            const areaTodos = this.todos.filter((t) => t.area_id === area.id);
            const totalAreaTodos = areaTodos.length;
            const doneAreaTodos = areaTodos.filter((t) => t.completed).length;
            const progressPct = totalAreaTodos > 0
                ? Math.round((doneAreaTodos / totalAreaTodos) * 100)
                : 0;
            const safeColor = this.escapeHtml(area.color || "#666");

            return `
                <div class="tree-node tree-area ${extraClass}" data-tree-node="area" data-id="${area.id}" role="button" aria-pressed="false">
                    <span class="area-swatch" style="background:${safeColor}"></span>
                    <span class="tree-label">${this.escapeHtml(area.name)}</span>
                    <span class="tree-actions">
                        <button class="tree-action edit-area-btn" type="button" title="Gebied bewerken" data-area-id="${area.id}" aria-label="Gebied bewerken"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg></button>
                    </span>
                    <span class="tree-area-bar" aria-hidden="true" style="background:${safeColor};"><i style="width:${progressPct}%; background:${safeColor};"></i></span>
                </div>`;
        };

        const renderGoal = (goal) => {
            const expanded = this.expandedGoalIds.has(goal.id);
            const projectsInGoal = activeProjects.filter((p) => p.goal_id === goal.id);
            const hasChildren = projectsInGoal.length > 0;
            const dateRange = this._formatGoalDateRange(goal);

            const chevron = hasChildren
                ? `<button class="tree-toggle" type="button" data-kind="goal" data-id="${goal.id}" aria-expanded="${expanded}" aria-label="Toggle"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="${expanded ? "6 9 12 15 18 9" : "9 18 15 12 9 6"}"/></svg></button>`
                : `<span class="tree-toggle tree-toggle-placeholder"></span>`;

            let html = `
                <div class="tree-node tree-goal" data-tree-node="goal" data-id="${goal.id}" role="button" aria-pressed="false">
                    ${chevron}
                    <svg class="tree-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>
                    <span class="tree-label">${this.escapeHtml(goal.name)}${dateRange ? `<span class="tree-label-meta"> · ${this.escapeHtml(dateRange)}</span>` : ""}</span>
                    <span class="tree-actions">
                        <button class="tree-action add-project-btn" type="button" title="Nieuw project" data-goal-id="${goal.id}" aria-label="Nieuw project">+</button>
                    </span>
                    <span class="sidebar-count tree-count" data-count-goal="${goal.id}"></span>
                </div>`;

            if (expanded && hasChildren) {
                html += `<div class="tree-children tree-children-goal">`;
                projectsInGoal.forEach((project) => {
                    html += `
                        <div class="tree-node tree-project" data-tree-node="project" data-id="${project.id}" role="button" aria-pressed="false">
                            <span class="tree-toggle tree-toggle-placeholder"></span>
                            <svg class="tree-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                            <span class="tree-label">${this.escapeHtml(project.name)}</span>
                            <span class="sidebar-count tree-count" data-count-project="${project.id}"></span>
                        </div>`;
                });
                html += `</div>`;
            }
            return html;
        };

        let html = "";
        activeAreas.forEach((area) => {
            html += renderArea(area);
        });
        if (archivedAreas.length > 0) {
            html += `
                <div class="tree-archived-header">Gearchiveerde gebieden</div>`;
            archivedAreas.forEach((area) => {
                html += renderArea(area, "tree-archived");
            });
        }

        this.areaNav.innerHTML = html;

        // Re-apply active state for the current view
        if (this.currentView.type === "area" || this.currentView.type === "goal" || this.currentView.type === "project") {
            document.querySelectorAll("[data-tree-node]").forEach((node) => {
                const kind = node.dataset.treeNode;
                const id = Number(node.dataset.id);
                const isActive = this.currentView.type === kind && this.currentView.value === id;
                node.classList.toggle("active", isActive);
                node.setAttribute("aria-pressed", isActive.toString());
            });
        }

        this.updateSidebarCounts();
    }

    _formatGoalDateRange(goal) {
        if (!goal.start_date && !goal.end_date) return "";
        const fmt = (d) => {
            if (!d) return "";
            const [y, m, day] = d.split("-");
            return `${day}-${m}-${y.slice(2)}`;
        };
        if (goal.start_date && goal.end_date) {
            return `${fmt(goal.start_date)} → ${fmt(goal.end_date)}`;
        }
        if (goal.end_date) return `→ ${fmt(goal.end_date)}`;
        return fmt(goal.start_date);
    }

    _syncModalAreaSwatch() {
        const swatch = document.getElementById("modalAreaSwatch");
        if (!swatch || !this.modalArea) return;
        const wrap = swatch.parentElement;
        const id = this.modalArea.value;
        const area = id ? this.areas.find((a) => String(a.id) === String(id)) : null;
        if (area && area.color) {
            swatch.style.background = area.color;
            wrap?.classList.add("has-area");
        } else {
            swatch.style.background = "";
            wrap?.classList.remove("has-area");
        }
    }

    _populateAreaSelects() {
        const activeAreas = this.areas.filter((a) => a.status === "active");
        const options = `<option value="">Geen gebied</option>` +
            activeAreas.map((a) =>
                `<option value="${a.id}">${this.escapeHtml(a.name)}</option>`
            ).join("");
        if (this.areaSelect) {
            const current = this.areaSelect.value;
            this.areaSelect.innerHTML = options;
            this.areaSelect.value = current;
        }
        if (this.modalArea) {
            const current = this.modalArea.value;
            this.modalArea.innerHTML = options;
            this.modalArea.value = current;
        }
        // Goal modal area picker needs at least one area; no "none" option.
        if (this.goalAreaSelect) {
            const current = this.goalAreaSelect.value;
            this.goalAreaSelect.innerHTML = activeAreas
                .map((a) => `<option value="${a.id}">${this.escapeHtml(a.name)}</option>`)
                .join("");
            this.goalAreaSelect.value = current;
        }
    }

    // --- Area modal ---

    openAreaModal(area = null) {
        if (!this.areaModal) return;
        this.editingAreaId = area ? area.id : null;
        this.areaModalTitle.textContent = area ? "Gebied bewerken" : "Nieuw gebied";
        this.areaNameInput.value = area ? area.name : "";
        this.areaColorInput.value = area ? area.color : "#1976D2";
        this.areaDescriptionInput.value = area ? area.description || "" : "";
        this.areaModal.hidden = false;
        this.areaNameInput.focus();
    }

    closeAreaModal() {
        if (!this.areaModal) return;
        this.areaModal.hidden = true;
        this.editingAreaId = null;
    }

    async saveAreaModal() {
        const name = this.areaNameInput.value.trim();
        if (!name) {
            this.areaNameInput.focus();
            return;
        }
        const color = this.areaColorInput.value.trim();
        const description = this.areaDescriptionInput.value.trim() || null;
        this.setStatus("");
        try {
            if (this.editingAreaId) {
                const data = await this.request(`/api/areas/${this.editingAreaId}`, {
                    method: "PATCH",
                    body: JSON.stringify({ name, color, description }),
                });
                if (data.area) {
                    this.areas = this.areas.map((a) =>
                        a.id === data.area.id ? data.area : a
                    );
                }
            } else {
                const data = await this.request("/api/areas", {
                    method: "POST",
                    body: JSON.stringify({ name, color, description }),
                });
                if (data.area) {
                    this.areas.push(data.area);
                    this.expandedAreaIds.add(data.area.id);
                }
            }
            this.closeAreaModal();
            this.renderAreaTree();
            this._populateAreaSelects();
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    // --- Goal modal ---

    openGoalModal(prefill = {}) {
        if (!this.goalModal) return;
        const goal = prefill.id ? prefill : null;
        this.editingGoalId = goal ? goal.id : null;
        this.goalModalTitle.textContent = goal ? "Doel bewerken" : "Nieuw doel";
        this.goalNameInput.value = goal ? goal.name : "";
        this.goalDescriptionInput.value = goal ? goal.description || "" : "";
        this.goalStartDateInput.value = goal ? goal.start_date || "" : "";
        this.goalEndDateInput.value = goal ? goal.end_date || "" : "";
        this._populateAreaSelects();
        if (prefill.area_id) {
            this.goalAreaSelect.value = String(prefill.area_id);
        } else if (goal) {
            this.goalAreaSelect.value = String(goal.area_id);
        }
        this.goalModal.hidden = false;
        this.goalNameInput.focus();
    }

    closeGoalModal() {
        if (!this.goalModal) return;
        this.goalModal.hidden = true;
        this.editingGoalId = null;
    }

    async saveGoalModal() {
        const name = this.goalNameInput.value.trim();
        if (!name) {
            this.goalNameInput.focus();
            return;
        }
        const areaIdRaw = this.goalAreaSelect.value;
        if (!areaIdRaw) {
            this.setStatus("Kies een gebied voor dit doel");
            return;
        }
        const areaId = Number(areaIdRaw);
        const description = this.goalDescriptionInput.value.trim() || null;
        const startDate = this.goalStartDateInput.value || null;
        const endDate = this.goalEndDateInput.value || null;
        this.setStatus("");
        try {
            if (this.editingGoalId) {
                const data = await this.request(`/api/goals/${this.editingGoalId}`, {
                    method: "PATCH",
                    body: JSON.stringify({
                        name,
                        area_id: areaId,
                        description,
                        start_date: startDate,
                        end_date: endDate,
                    }),
                });
                if (data.goal) {
                    this.goals = this.goals.map((g) =>
                        g.id === data.goal.id ? data.goal : g
                    );
                }
            } else {
                const data = await this.request("/api/goals", {
                    method: "POST",
                    body: JSON.stringify({
                        name,
                        area_id: areaId,
                        description,
                        start_date: startDate,
                        end_date: endDate,
                    }),
                });
                if (data.goal) {
                    this.goals.push(data.goal);
                    this.expandedAreaIds.add(areaId);
                }
            }
            this.closeGoalModal();
            this.renderAreaTree();
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    renderProjectsSidebar() {
        if (!this.projectNav) return;

        // "Losse projecten" shows only projects with no area and no goal — those are
        // the orphans. Projects attached to an area or goal render inside the area tree.
        const unparented = this.projects.filter(
            (p) => (p.status === undefined || p.status === "active") && !p.area_id && !p.goal_id
        );
        const completedProjects = this.completedProjects;

        // Render unparented projects
        this.projectNav.innerHTML = unparented
            .map(project => `
                <button class="sidebar-item" type="button" data-project-filter="${project.id}" aria-pressed="false">
                    <svg class="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                    </svg>
                    <span class="sidebar-label">${this.escapeHtml(project.name)}</span>
                    <span class="sidebar-count" data-count-project="${project.id}"></span>
                </button>`)
            .join("");

        // Archive section was removed from the sidebar by design — completed
        // projects are reachable from project routing only.
        const archivedSection = document.getElementById("projectsArchivedSection");
        const archivedNav = document.getElementById("projectArchivedNav");
        if (archivedSection) archivedSection.style.display = "none";
        if (archivedNav) archivedNav.innerHTML = "";

        // Re-apply active state if currently viewing this project
        if (this.currentView.type === "project") {
            const allProjectButtons = document.querySelectorAll("[data-project-filter]");
            allProjectButtons.forEach(item => {
                const isActive = Number(item.dataset.projectFilter) === this.currentView.value;
                item.classList.toggle("active", isActive);
                item.setAttribute("aria-pressed", isActive.toString());
            });
        }
        this.updateSidebarCounts();
    }

    async createProject(arg) {
        // Accept either a plain name (legacy sidebar form) or an options object
        // { name?, areaId?, goalId? } from the area-tree "+ project" buttons.
        let name, areaId, goalId;
        if (typeof arg === "string") {
            name = arg;
            areaId = null;
            goalId = null;
        } else if (arg && typeof arg === "object") {
            name = (arg.name || "").trim();
            areaId = arg.areaId || null;
            goalId = arg.goalId || null;
        }
        if (!name) {
            // Prompt the user inline via a simple browser prompt when invoked from the tree.
            const promptedName = window.prompt(
                goalId ? "Naam van het project (onder dit doel):" : "Naam van het project:"
            );
            if (!promptedName || !promptedName.trim()) return;
            name = promptedName.trim();
        }
        if (this.newProjectForm) this.newProjectForm.hidden = true;
        if (this.newProjectInput) this.newProjectInput.value = "";
        try {
            const payload = { name };
            if (goalId) payload.goal_id = goalId;
            else if (areaId) payload.area_id = areaId;
            const data = await this.request("/api/projects", {
                method: "POST",
                body: JSON.stringify(payload),
            });
            if (data.project) {
                this.projects.unshift(data.project);
                this.renderProjectsSidebar();
                this.renderAreaTree();
                this._populateProjectSelects();
            }
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    async archiveProject() {
        // Defense in depth: only projects can be completed. Lists (inbox/today),
        // areas, and goals use archive/status semantics handled elsewhere. The
        // toolbar button is already hidden outside project views (see setView),
        // this guard prevents direct/stale calls from mutating anything.
        if (this.currentView.type !== "project") return;
        const projectId = this.currentView.value;
        const isActive = this.projects.some(
            (p) => p.id === projectId && (p.status === undefined || p.status === "active")
        );
        if (!isActive) return;
        this.setStatus("");
        try {
            const project = this.projects.find(p => p.id === projectId);
            await this.request(`/api/projects/${projectId}/status`, {
                method: "PATCH",
                body: JSON.stringify({ status: "completed" }),
            });
            if (project) this.completedProjects.unshift({ ...project, status: "completed" });
            this.projects = this.projects.filter(p => p.id !== projectId);
            this.renderProjectsSidebar();
            this.renderAreaTree();
            this._populateProjectSelects();
            this.setView({ type: "list", value: "inbox" });
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    async reviveProject() {
        if (this.currentView.type !== "project") return;
        const projectId = this.currentView.value;
        const archived = this.completedProjects.find(p => p.id === projectId);
        if (!archived) return;
        this.setStatus("");
        try {
            await this.request(`/api/projects/${projectId}/status`, {
                method: "PATCH",
                body: JSON.stringify({ status: "active" }),
            });
            this.completedProjects = this.completedProjects.filter(p => p.id !== projectId);
            this.projects.unshift({ ...archived, status: "active" });
            this.renderProjectsSidebar();
            this.renderAreaTree();
            this._populateProjectSelects();
            // Re-apply view so the header actions refresh to the active-project set.
            this.setView({ type: "project", value: projectId });
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    _populateProjectSelects() {
        const activeProjects = this.projects.filter(p => p.status === undefined || p.status === "active");
        const projectOptions = activeProjects.map(p =>
            `<option value="${p.id}">${this.escapeHtml(p.name)}</option>`
        ).join("");
        if (this.projectSelect) {
            this.projectSelect.innerHTML = `<option value="">Geen project</option>` + projectOptions;
        }
        if (this.modalProject) {
            const current = this.modalProject.value;
            this.modalProject.innerHTML = `<option value="">—</option>` + projectOptions;
            this.modalProject.value = current;
        }
    }

    async addTodo() {
        const title = this.todoInput.value.trim();
        if (!title) {
            return;
        }
        const areaIdRaw = this.areaSelect?.value;
        const areaId = areaIdRaw ? Number(areaIdRaw) : null;
        const priority = this.normalizePriority(this.prioritySelect?.value);
        const startDate = this.startDateInput?.value || null;
        const plannedDate = this.plannedDateInput?.value || null;
        const plannedTime = this.plannedTimeInput?.value || null;
        const deadline = this.deadlineInput?.value || null;
        const duration = this.durationInput?.value ? Number(this.durationInput.value) : null;
        const recurrenceUnitVal = this.recurrenceUnit?.value || null;
        const recurrenceIntervalVal = recurrenceUnitVal && this.recurrenceInterval?.value ? Number(this.recurrenceInterval.value) : null;
        const recurrenceEndVal = recurrenceUnitVal && this.recurrenceEnd?.value ? this.recurrenceEnd.value : null;
        const projectId = this.projectSelect?.value ? Number(this.projectSelect.value) : null;

        // Determine target list from current view; Vandaag is not a list so
        // tasks created there land in inbox but get planned_date = today.
        let targetList = "inbox";
        if (this.currentView.type === "list" && this.currentView.value !== "today") {
            targetList = this.currentView.value;
        }

        let plannedDateFinal = plannedDate;
        if (!plannedDateFinal && this._isTodayView()) {
            plannedDateFinal = this.getToday();
        }

        this.addButton.disabled = true;
        this.setStatus("");

        // A task lives in a list XOR a project; if we're creating inside a
        // project view, omit `list` so the backend trigger keeps it NULL.
        const body = {
            title,
            area_id: areaId,
            priority,
            start_date: startDate,
            planned_date: plannedDateFinal,
            planned_time: plannedTime,
            deadline,
            duration,
            recurrence_interval: recurrenceIntervalVal,
            recurrence_unit: recurrenceUnitVal,
            recurrence_end: recurrenceEndVal,
            project_id: projectId,
        };
        if (!projectId) body.list = targetList;

        try {
            const data = await this.request("/api/todos", {
                method: "POST",
                body: JSON.stringify(body),
            });
            if (data.todo) {
                this.todos.unshift(this.normalizeTodo(data.todo));
                this.todoInput.value = "";
                if (this.areaSelect) this.areaSelect.value = "";
                if (this.prioritySelect) this.prioritySelect.value = "not_set";
                if (this.startDateInput) this.startDateInput.value = "";
                if (this.plannedDateInput) this.plannedDateInput.value = "";
                if (this.plannedTimeInput) this.plannedTimeInput.value = "";
                if (this.deadlineInput) this.deadlineInput.value = "";
                if (this.durationInput) this.durationInput.value = "";
                if (this.recurrenceUnit) {
                    this.recurrenceUnit.value = "";
                    this.recurrenceInterval.value = "1";
                    this.recurrenceInterval.hidden = true;
                    this.recurrenceEnd.value = "";
                    this.recurrenceEnd.hidden = true;
                    this.recurrenceEndLabel.hidden = true;
                }
                if (this.projectSelect && this.currentView.type !== "project") {
                    this.projectSelect.value = "";
                }
                this.renderTodos();
                this.hideAddTask();
            }
        } catch (error) {
            this.setStatus(error.message);
        } finally {
            this.addButton.disabled = false;
        }
    }

    async addTodoForDay(dateStr, title) {
        const trimmed = title.trim();
        if (!trimmed || !dateStr) return;
        this.setStatus("");
        try {
            const data = await this.request("/api/todos", {
                method: "POST",
                body: JSON.stringify({
                    title: trimmed,
                    list: "inbox",
                    priority: "not_set",
                    planned_date: dateStr,
                }),
            });
            if (data.todo) {
                this.todos.unshift(this.normalizeTodo(data.todo));
                // Keep the add row open so the user can type more tasks for
                // the same day without having to click again.
                this.weekAddDay = dateStr;
                this.renderTodos();
            }
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    async toggleTodo(id) {
        const todo = this.todos.find((item) => item.id === id);
        if (!todo) {
            return;
        }

        this.setStatus("");
        try {
            const data = await this.request(`/api/todos/${id}`, {
                method: "PATCH",
                body: JSON.stringify({ completed: !todo.completed }),
            });
            if (data.todo) {
                this.applyTodoUpdate(data.todo);
                if (data.spawned_todo) {
                    this.todos.unshift(this.normalizeTodo(data.spawned_todo));
                }
                this.renderTodos();
            }
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    async deleteTodo(id) {
        this.setStatus("");
        try {
            await this.request(`/api/todos/${id}`, {
                method: "DELETE",
            });
            this.todos = this.todos.filter((todo) => todo.id !== id);
            this.renderTodos();
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    async moveTodo(id, targetList) {
        this.setStatus("");
        try {
            // Also clear project_id: the exclusivity trigger would otherwise
            // wipe `list` back to NULL for a task that still has a project.
            const data = await this.request(`/api/todos/${id}`, {
                method: "PATCH",
                body: JSON.stringify({ list: targetList, project_id: null }),
            });
            if (data.todo) {
                this.applyTodoUpdate(data.todo);
                this.renderTodos();
            }
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    async setArea(id, areaId) {
        this.setStatus("");
        try {
            const data = await this.request(`/api/todos/${id}`, {
                method: "PATCH",
                body: JSON.stringify({ area_id: areaId === null ? null : Number(areaId) }),
            });
            if (data.todo) {
                this.applyTodoUpdate(data.todo);
                this.renderTodos();
            }
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    async setPriority(id, priority) {
        this.setStatus("");
        try {
            const normalized = this.normalizePriority(priority);
            const data = await this.request(`/api/todos/${id}`, {
                method: "PATCH",
                body: JSON.stringify({ priority: normalized }),
            });
            if (data.todo) {
                this.applyTodoUpdate(data.todo);
                this.renderTodos();
            }
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    async setDateField(id, field, value) {
        this.setStatus("");
        try {
            const data = await this.request(`/api/todos/${id}`, {
                method: "PATCH",
                body: JSON.stringify({ [field]: value }),
            });
            if (data.todo) {
                this.applyTodoUpdate(data.todo);
                this.renderTodos();
            }
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    async setDuration(id, value) {
        this.setStatus("");
        try {
            const data = await this.request(`/api/todos/${id}`, {
                method: "PATCH",
                body: JSON.stringify({ duration: value }),
            });
            if (data.todo) {
                this.applyTodoUpdate(data.todo);
                this.renderTodos();
            }
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    async clearCompleted() {
        this.setStatus("");
        try {
            let url = "/api/todos/completed";
            if (this.currentView.type === "list") {
                const params = new URLSearchParams({
                    list: this.currentView.value,
                });
                url += `?${params.toString()}`;
            }
            await this.request(url, { method: "DELETE" });

            if (this.currentView.type === "list") {
                this.todos = this.todos.filter(
                    (todo) =>
                        !(
                            todo.completed &&
                            todo.list === this.currentView.value
                        )
                );
            } else {
                this.todos = this.todos.filter((todo) => !todo.completed);
            }
            this.renderTodos();
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    // --- Menu management ---

    closeAllProjectMenus() {
        this._closeProjectMenu();
    }

    closeAllMenus() {
        this.closeAllProjectMenus();
        this.todoList
            .querySelectorAll(".todo-item.menu-open")
            .forEach((item) => {
                item.classList.remove("menu-open");
            });
        this.todoList.querySelectorAll(".menu-btn").forEach((button) => {
            button.setAttribute("aria-expanded", "false");
        });
        document.body.classList.remove("menu-backdrop-active");
    }

    toggleMenu(item, button) {
        const shouldOpen = !item.classList.contains("menu-open");
        this.closeAllMenus();
        if (shouldOpen) {
            item.classList.add("menu-open");
            button.setAttribute("aria-expanded", "true");
            document.body.classList.add("menu-backdrop-active");
        }
    }

    applyTodoUpdate(updated) {
        const prev = this.todos.find((t) => t.id === updated.id);
        if (prev && typeof updated.completed === "boolean" && prev.completed !== updated.completed) {
            if (updated.completed) {
                this._completedTodayIds.add(updated.id);
            } else {
                this._completedTodayIds.delete(updated.id);
            }
            this._saveCompletedTodayIds();
        }
        this.todos = this.todos.map((todo) => {
            if (todo.id !== updated.id) {
                return todo;
            }
            const merged = { ...todo, ...updated };
            return this.normalizeTodo(merged);
        });
        // Refresh modal if it's open for this task
        if (this.openTodoId === updated.id) {
            const refreshed = this.todos.find((t) => t.id === updated.id);
            if (refreshed) this.populateModal(refreshed);
        }
    }

    // --- Date helper ---

    getToday() {
        return new Date().toISOString().split("T")[0];
    }

    getWeekRange(offset = 0) {
        const now = new Date();
        const daysFromMonday = (now.getDay() + 6) % 7; // Mon=0 … Sun=6
        const start = new Date(now);
        start.setDate(now.getDate() - daysFromMonday + offset * 7);
        const end = new Date(start);
        end.setDate(start.getDate() + 6);
        const fmt = (d) => d.toISOString().split("T")[0];
        return { start: fmt(start), end: fmt(end) };
    }

    // --- Modal ---

    openModal(id) {
        const todo = this.todos.find((t) => t.id === id);
        if (!todo) return;
        this.openTodoId = id;
        this.populateModal(todo);
        this.taskModal.hidden = false;
    }

    populateModal(todo) {
        this.modalCheckbox.checked = todo.completed;
        this.modalTitleInput.value = todo.title;
        this._autoResizeTextarea(this.modalTitleInput);
        if (this.modalState) this.modalState.value = todo.state || "to_do";
        // Project tasks have list=NULL by invariant; show the empty placeholder
        // option so the modal doesn't misleadingly claim the task is in "Inbox".
        this.modalList.value = todo.project_id ? "" : (todo.list || "inbox");
        this._setModalDateField(this.modalPlannedDate, todo.planned_date || "");
        this._setModalDateField(this.modalStartDate, todo.start_date || "");
        if (this.modalPlannedTime) {
            this.modalPlannedTime.value = this._formatTimeValue(todo.planned_time);
        }
        this.modalDuration.value = todo.duration || "";
        this._setModalDateField(this.modalDeadline, todo.deadline || "");
        this.modalPriority.value = this.normalizePriority(todo.priority);
        this.modalArea.value = todo.area_id ? String(todo.area_id) : "";
        this._syncModalAreaSwatch();
        if (this.modalProject) this.modalProject.value = todo.project_id ? String(todo.project_id) : "";
        if (this.modalRecurrenceUnit) {
            this.modalRecurrenceUnit.value = todo.recurrence_unit || "";
            this.modalRecurrenceInterval.value = todo.recurrence_interval || "";
            this.modalRecurrenceEnd.value = todo.recurrence_end || "";
            this._syncModalRecurrenceVisibility();
        }
        this._syncModalFieldStates();
        this._renderModalTimeSection(todo);
    }

    _syncModalFieldStates() {
        [
            { el: this.modalState,       isSet: () => true },
            { el: this.modalList,        isSet: () => true },
            { el: this.modalPlannedDate, isSet: () => !!this.modalPlannedDate.dataset.date },
            { el: this.modalStartDate,   isSet: () => !!this.modalStartDate.dataset.date },
            { el: this.modalDuration,    isSet: () => !!this.modalDuration.value && Number(this.modalDuration.value) > 0 },
            { el: this.modalPlannedTime, isSet: () => !!this.modalPlannedTime?.value },
            { el: this.modalDeadline,    isSet: () => !!this.modalDeadline.dataset.date },
            { el: this.modalPriority,    isSet: () => this.modalPriority.value !== "not_set" },
            { el: this.modalArea,        isSet: () => !!this.modalArea.value },
            { el: this.modalProject,     isSet: () => !!this.modalProject?.value },
        ].forEach(({ el, isSet }) => {
            if (!el) return;
            const field = el.closest(".modal-field");
            if (!field) return;
            const set = isSet();
            field.classList.toggle("is-set", set);
            if (set) field.classList.remove("is-editing");
        });
    }

    closeModal() {
        if (!this.taskModal.hidden) {
            this.taskModal.hidden = true;
            this.openTodoId = null;
            this.closeDatePicker();
        }
    }

    async saveModalTitle() {
        const title = this.modalTitleInput.value.trim();
        if (!title || !this.openTodoId) return;
        const todo = this.todos.find((t) => t.id === this.openTodoId);
        if (todo && todo.title === title) return; // no change
        this.setStatus("");
        try {
            const data = await this.request(`/api/todos/${this.openTodoId}`, {
                method: "PATCH",
                body: JSON.stringify({ title }),
            });
            if (data.todo) {
                this.applyTodoUpdate(data.todo);
                this.renderTodos();
            }
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    async saveModalField(field, value) {
        if (!this.openTodoId) return;
        let payload;
        if (field === "duration") {
            payload = { duration: value ? Number(value) : null };
        } else if (field === "planned_time") {
            payload = { planned_time: value || null };
        } else if (field === "list") {
            // The "—" placeholder is for display only (project tasks have no
            // list). Ignore it so we don't POST an invalid empty list value.
            if (!value) return;
            // Moving a task to a list must also clear project_id; otherwise
            // the exclusivity trigger wipes `list` straight back to NULL.
            payload = { list: value, project_id: null };
        } else if (field === "project") {
            payload = { project_id: value ? Number(value) : null };
        } else if (field === "area") {
            payload = { area_id: value ? Number(value) : null };
        } else {
            payload = { [field]: value || null };
        }
        this.setStatus("");
        try {
            const data = await this.request(`/api/todos/${this.openTodoId}`, {
                method: "PATCH",
                body: JSON.stringify(payload),
            });
            if (data.todo) {
                this.applyTodoUpdate(data.todo);
                this.renderTodos();
            }
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    // --- Filtering ---

    getFilteredTodos() {
        const view = this.currentView;
        switch (view.type) {
            case "list":
                if (view.value === "today") {
                    const today = this.getToday();
                    return this.todos.filter(
                        (t) => !t.completed && !t.project_id && t.planned_date === today
                    );
                }
                if (view.value === "inbox") {
                    return this.todos.filter(
                        (todo) => todo.list === "inbox" && !todo.completed && !todo.area_id && !todo.project_id && todo.state !== "waiting"
                    );
                }
                return this.todos.filter(
                    (todo) => todo.list === view.value && !todo.completed && !todo.project_id
                );
            case "view":
                if (view.value === "all") {
                    return this.todos.filter((todo) => !todo.completed);
                }
                if (view.value === "week" || view.value === "next-week") {
                    const offset = view.value === "next-week" ? 1 : 0;
                    const { start, end } = this.getWeekRange(offset);
                    return this.todos.filter(
                        (t) =>
                            !t.completed &&
                            ((t.planned_date && t.planned_date >= start && t.planned_date <= end) ||
                             (t.deadline && t.deadline >= start && t.deadline <= end))
                    );
                }
                if (view.value === "waiting") {
                    return this.todos.filter((todo) => todo.state === "waiting");
                }
                if (view.value === "completed") {
                    return this.todos.filter((todo) => todo.completed);
                }
                return this.todos;
            case "area":
                return this.todos.filter(
                    (todo) => !todo.completed && this.resolveTaskAreaId(todo) === view.value
                );
            case "goal": {
                // Tasks in a goal: those whose project belongs to the goal.
                const projectIdsInGoal = new Set(
                    this.projects
                        .filter((p) => p.goal_id === view.value)
                        .map((p) => p.id)
                );
                return this.todos.filter(
                    (todo) => !todo.completed && todo.project_id && projectIdsInGoal.has(todo.project_id)
                );
            }
            case "project": {
                // For archived projects, include completed tasks so the user can
                // review everything that was inside before reviving.
                const isCompleted = this.completedProjects.some(p => p.id === view.value);
                return this.todos.filter(
                    (todo) => todo.project_id === view.value && (isCompleted || !todo.completed)
                );
            }
            default:
                return this.todos;
        }
    }

    // --- Rendering ---

    renderTodos() {
        // The today view has its own dedicated rendering path.
        if (this._isTodayView()) {
            this.renderTodayView();
            this.updateItemCount();
            this.updateSidebarCounts();
            return;
        }

        // Project views render as a kanban board.
        if (this._isProjectView()) {
            this.renderProjectView();
            this.updateItemCount();
            this.updateSidebarCounts();
            return;
        }

        const todos = this.getFilteredTodos();

        if (todos.length === 0) {
            const label = this.getViewLabel();
            this.todoList.innerHTML = `<li class="empty-state">Geen taken in ${this.escapeHtml(label)}.</li>`;
            this.updateItemCount();
            this.updateSidebarCounts();
            return;
        }

        const view = this.currentView;
        const isWeekView = view.type === "view" && (view.value === "week" || view.value === "next-week");

        if (isWeekView) {
            this.todoList.innerHTML = this._renderWeekGroupedHtml(todos, view.value);
            this._focusWeekAddInputIfPending();
        } else {
            this.todoList.innerHTML = todos
                .map((todo, index) => this._renderTodoItemHtml(todo, index))
                .join("");
        }

        this.updateItemCount();
        this.updateSidebarCounts();
    }

    _focusWeekAddInputIfPending() {
        if (!this.weekAddDay) return;
        const input = this.todoList.querySelector(
            `.week-day-add-input[data-day="${this.weekAddDay}"]`
        );
        if (input) {
            input.focus();
            const len = input.value.length;
            input.setSelectionRange(len, len);
        }
    }

    _renderTodoItemHtml(todo, index) {
        const checked = todo.completed ? "checked" : "";
        const completedClass = todo.completed ? "completed" : "";
        const normalizedPriority = this.normalizePriority(todo.priority);
        const priorityClass = `priority-${normalizedPriority}`;

        const alternateList =
            this.availableLists.find((list) => list !== todo.list) ||
            this.availableLists[0];
        const moveLabel = `Verplaats naar ${this.getListLabel(alternateList)}`;

        const areaLabel = this.getAreaLabel(todo.area_id);
        const areaColor = todo.area_id ? this.getAreaColor(todo.area_id) : null;
        const areaMarkup = areaLabel
            ? `<span class="todo-meta-chip todo-area"><span class="todo-area-swatch" style="background:${this.escapeHtml(areaColor || "#888")}"></span>${this.escapeHtml(areaLabel)}</span>`
            : "";

        const projectLabel = this.currentView.type !== "project"
            ? this.getProjectLabel(todo.project_id)
            : "";
        const projectMarkup = projectLabel
            ? `<span class="todo-meta-chip todo-project">${this.escapeHtml(projectLabel)}</span>`
            : "";

        const stateMarkup = todo.state && todo.state !== "to_do"
            ? `<span class="todo-meta-chip todo-state-${todo.state}">${this.escapeHtml(this.getStateLabel(todo.state))}</span>`
            : "";

        // Project tasks have list=null by invariant — skip the chip
        // instead of rendering a misleading "Inbox" label.
        const listLabel =
            this.currentView.type !== "list" && todo.list
                ? `<span class="todo-meta-chip">${this.escapeHtml(this.getListLabel(todo.list))}</span>`
                : "";

        const startDateMarkup = todo.start_date
            ? `<span class="todo-meta-chip todo-start-date">Start: ${this.escapeHtml(todo.start_date)}</span>`
            : "";
        const plannedDateMarkup = todo.planned_date
            ? `<span class="todo-meta-chip todo-planned-date">Gepland: ${this.escapeHtml(todo.planned_date)}</span>`
            : "";
        let deadlineMarkup = "";
        if (todo.deadline) {
            const todayDate = this.getToday();
            if (todo.deadline < todayDate) {
                const daysDiff = Math.round((Date.parse(todayDate) - Date.parse(todo.deadline)) / 86400000);
                deadlineMarkup = `<span class="todo-meta-chip todo-deadline">${daysDiff}d geleden</span>`;
            } else {
                deadlineMarkup = `<span class="todo-meta-chip todo-deadline">${this.escapeHtml(todo.deadline)}</span>`;
            }
        }
        const durationMarkup = todo.duration
            ? `<span class="todo-meta-chip todo-duration">${this.escapeHtml(String(todo.duration))}m</span>`
            : "";

        const recurrenceMarkup = todo.recurrence_interval && todo.recurrence_unit
            ? `<span class="todo-meta-chip chip-recurrence" title="Herhaalt elke ${todo.recurrence_interval} ${todo.recurrence_unit}"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg></span>`
            : "";

        const hasMeta =
            areaLabel ||
            projectLabel ||
            listLabel ||
            todo.start_date ||
            todo.planned_date ||
            todo.deadline ||
            todo.duration ||
            todo.recurrence_interval ||
            (todo.state && todo.state !== "to_do");
        const metadataMarkup = hasMeta
            ? `<div class="todo-meta">${listLabel}${stateMarkup}${startDateMarkup}${plannedDateMarkup}${deadlineMarkup}${durationMarkup}${areaMarkup}${projectMarkup}${recurrenceMarkup}</div>`
            : "";

        const activeAreas = this.areas.filter((a) => a.status === "active");
        const areaMenuItems = activeAreas
            .map((a) => `<button class="todo-menu-item set-area-btn" data-id="${todo.id}" type="button" data-area-id="${a.id}" role="menuitem">Gebied: ${this.escapeHtml(a.name)}</button>`)
            .join("");
        return `
        <li class="todo-item ${completedClass} ${priorityClass}" data-id="${todo.id}" style="animation-delay: ${index * 25}ms">
            <input type="checkbox" class="todo-checkbox" data-id="${todo.id}" ${checked}>
            <div class="todo-content">
                <span class="todo-text ${completedClass}">${this.escapeHtml(todo.title)}</span>
                ${metadataMarkup}
            </div>
            <div class="todo-actions">
                <button class="menu-btn" data-id="${todo.id}" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Task actions">...</button>
                <div class="todo-menu" role="menu">
                    <button class="todo-menu-item change-list-btn" data-id="${todo.id}" type="button" data-target-list="${alternateList}" role="menuitem">${this.escapeHtml(moveLabel)}</button>
                    ${areaMenuItems}
                    <button class="todo-menu-item set-area-btn" data-id="${todo.id}" type="button" data-area-id="" role="menuitem">Gebied wissen</button>
                    <button class="todo-menu-item set-priority-btn" data-id="${todo.id}" type="button" data-priority="high" role="menuitem">Prioriteit: Hoog</button>
                    <button class="todo-menu-item set-priority-btn" data-id="${todo.id}" type="button" data-priority="medium" role="menuitem">Prioriteit: Gemiddeld</button>
                    <button class="todo-menu-item set-priority-btn" data-id="${todo.id}" type="button" data-priority="low" role="menuitem">Prioriteit: Laag</button>
                    <button class="todo-menu-item set-priority-btn" data-id="${todo.id}" type="button" data-priority="not_set" role="menuitem">Prioriteit wissen</button>
                    <label class="todo-menu-item todo-menu-date-item" role="menuitem">
                        <span>Startdatum</span>
                        <input type="date" class="set-date-input" data-id="${todo.id}" data-field="start_date" value="${todo.start_date || ''}">
                    </label>
                    <label class="todo-menu-item todo-menu-date-item" role="menuitem">
                        <span>Geplande datum</span>
                        <input type="date" class="set-date-input" data-id="${todo.id}" data-field="planned_date" value="${todo.planned_date || ''}">
                    </label>
                    <label class="todo-menu-item todo-menu-date-item" role="menuitem">
                        <span>Deadline</span>
                        <input type="date" class="set-date-input" data-id="${todo.id}" data-field="deadline" value="${todo.deadline || ''}">
                    </label>
                    <label class="todo-menu-item todo-menu-date-item" role="menuitem">
                        <span>Duur (min)</span>
                        <input type="number" class="set-duration-input" data-id="${todo.id}" value="${todo.duration || ''}" min="1" placeholder="—">
                    </label>
                    <button class="todo-menu-item delete-btn" data-id="${todo.id}" type="button" role="menuitem">Verwijderen</button>
                </div>
            </div>
        </li>`;
    }

    _renderWeekGroupedHtml(todos, weekValue) {
        const offset = weekValue === "next-week" ? 1 : 0;
        const { start, end } = this.getWeekRange(offset);
        const today = this.getToday();
        const days = this._weekDays(start);

        const byDay = new Map();
        for (const t of todos) {
            const day = this._taskWeekDay(t, start, end);
            if (!day) continue;
            if (!byDay.has(day)) byDay.set(day, []);
            byDay.get(day).push(t);
        }

        const eventsByDay = this._weekEventsByDay(start, end);

        // Upcoming days (today and later) are shown first in chronological
        // order. Past days in the same week collapse into an "Earlier this
        // week" section below, so the focus stays on what's ahead.
        const upcomingDays = days.filter((d) => d >= today);
        const pastDays = days.filter((d) => d < today);

        const fragments = [];
        let itemIndex = 0;

        const renderDay = (day) => {
            const collapsed = this.collapsedWeekDays.has(day);
            fragments.push(this._renderWeekDayHeader(day, today, collapsed));
            if (collapsed) return;
            const items = byDay.get(day) || [];
            const events = eventsByDay.get(day) || [];
            for (const e of events) {
                fragments.push(this._renderWeekEventHtml(e));
            }
            for (const t of items) {
                fragments.push(this._renderTodoItemHtml(t, itemIndex++));
            }
            if (items.length === 0 && events.length === 0) {
                fragments.push(`<li class="week-day-empty">Geen taken</li>`);
            }
            fragments.push(this._renderWeekDayAddHtml(day));
        };

        for (const day of upcomingDays) {
            renderDay(day);
        }

        const pastDaysWithContent = pastDays.filter(
            (d) => byDay.has(d) || eventsByDay.has(d)
        );
        if (pastDaysWithContent.length > 0) {
            fragments.push(`<li class="week-section-divider">Eerder deze week</li>`);
            for (const day of pastDaysWithContent) {
                renderDay(day);
            }
        }

        return fragments.join("");
    }

    _weekEventsByDay(start, end) {
        const events = this.calendarEventsByRange.get(`${start}|${end}`) || [];
        const sorted = [...events].sort(
            (a, b) => (Date.parse(a.start_at) || 0) - (Date.parse(b.start_at) || 0)
        );
        const byDay = new Map();
        for (const e of sorted) {
            const day = this._eventDateKey(e);
            if (day < start || day > end) continue;
            if (!byDay.has(day)) byDay.set(day, []);
            byDay.get(day).push(e);
        }
        return byDay;
    }

    _renderWeekEventHtml(event) {
        const color = event.subscription_color || "#0288D1";
        const time = this._formatEventTime(event);
        const locationMarkup = event.location
            ? `<span class="calendar-event-location">${this.escapeHtml(event.location)}</span>`
            : "";
        return `
        <li class="calendar-event-item week-day-event" style="border-left-color:${this.escapeHtml(color)}">
            <span class="calendar-event-time">${this.escapeHtml(time)}</span>
            <span class="calendar-event-summary">${this.escapeHtml(event.summary || "(geen titel)")}</span>
            ${locationMarkup}
            <span class="calendar-event-source">${this.escapeHtml(event.subscription_name || "")}</span>
        </li>`;
    }

    _renderWeekDayHeader(dateStr, today, collapsed = false) {
        const classes = ["week-day-header"];
        if (dateStr === today) classes.push("is-today");
        if (collapsed) classes.push("is-collapsed");
        const chevron = `<svg class="week-day-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>`;
        const label = this.escapeHtml(this._weekDayLabel(dateStr, today));
        return `<li class="${classes.join(" ")}" data-day="${this.escapeHtml(dateStr)}" role="button" tabindex="0" aria-expanded="${collapsed ? "false" : "true"}">${chevron}<span class="week-day-label">${label}</span></li>`;
    }

    _renderWeekDayAddHtml(dateStr) {
        const day = this.escapeHtml(dateStr);
        if (this.weekAddDay === dateStr) {
            return `<li class="week-day-add is-editing" data-day="${day}"><input type="text" class="week-day-add-input" data-day="${day}" placeholder="Nieuwe taak..." autocomplete="off" maxlength="280"></li>`;
        }
        return `<li class="week-day-add" data-day="${day}" role="button" tabindex="0"><span class="week-day-add-label">+ Taak toevoegen</span></li>`;
    }

    _weekDayLabel(dateStr, today) {
        const DAYS = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"];
        const MONTHS = ["jan.", "feb.", "mrt.", "apr.", "mei", "jun.", "jul.", "aug.", "sep.", "okt.", "nov.", "dec."];
        const [y, m, d] = dateStr.split("-").map(Number);
        const date = new Date(y, m - 1, d);
        const dayName = DAYS[date.getDay()];
        const capitalizedDay = dayName.charAt(0).toUpperCase() + dayName.slice(1);
        const dayMonth = `${d} ${MONTHS[m - 1]}`;
        const base = `${capitalizedDay} ${dayMonth}`;
        return dateStr === today ? `Vandaag · ${base}` : base;
    }

    _weekDays(startDateStr) {
        const [y, m, d] = startDateStr.split("-").map(Number);
        const start = new Date(y, m - 1, d);
        const days = [];
        for (let i = 0; i < 7; i++) {
            const day = new Date(start);
            day.setDate(start.getDate() + i);
            const s = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
            days.push(s);
        }
        return days;
    }

    _taskWeekDay(todo, start, end) {
        if (todo.planned_date && todo.planned_date >= start && todo.planned_date <= end) {
            return todo.planned_date;
        }
        if (todo.deadline && todo.deadline >= start && todo.deadline <= end) {
            return todo.deadline;
        }
        return null;
    }

    updateItemCount() {
        const filtered = this.getFilteredTodos();
        const count = filtered.length;
        this.itemCount.textContent = `${count} ${count === 1 ? "taak" : "taken"}`;
    }

    updateSidebarCounts() {
        const activeTodos = this.todos.filter((t) => !t.completed);
        const completedTodos = this.todos.filter((t) => t.completed);

        // List counts (Today includes tasks with planned_date === today)
        const todayStr = this.getToday();
        document.querySelectorAll("[data-count-list]").forEach((el) => {
            const list = el.dataset.countList;
            const count =
                list === "today"
                    ? activeTodos.filter(
                          (t) => !t.project_id && t.planned_date === todayStr
                      ).length
                    : list === "inbox"
                    ? activeTodos.filter((t) => t.list === "inbox" && !t.area_id && !t.project_id && t.state !== "waiting").length
                    : activeTodos.filter((t) => t.list === list && !t.project_id).length;
            el.textContent = count > 0 ? String(count) : "";
        });

        // View counts
        document.querySelectorAll("[data-count-view]").forEach((el) => {
            const view = el.dataset.countView;
            if (view === "all") {
                el.textContent =
                    activeTodos.length > 0 ? String(activeTodos.length) : "";
            } else if (view === "week" || view === "next-week") {
                const offset = view === "next-week" ? 1 : 0;
                const { start, end } = this.getWeekRange(offset);
                const count = activeTodos.filter(
                    (t) =>
                        (t.planned_date && t.planned_date >= start && t.planned_date <= end) ||
                        (t.deadline && t.deadline >= start && t.deadline <= end)
                ).length;
                el.textContent = count > 0 ? String(count) : "";
            } else if (view === "waiting") {
                const count = this.todos.filter((t) => t.state === "waiting").length;
                el.textContent = count > 0 ? String(count) : "";
            } else if (view === "completed") {
                el.textContent =
                    completedTodos.length > 0
                        ? String(completedTodos.length)
                        : "";
            }
        });

        // Area counts — include tasks with direct area_id AND tasks whose
        // project→goal or project→area resolves to this area.
        document.querySelectorAll("[data-count-area]").forEach((el) => {
            const areaId = Number(el.dataset.countArea);
            const count = activeTodos.filter(
                (t) => this.resolveTaskAreaId(t) === areaId
            ).length;
            el.textContent = count > 0 ? String(count) : "";
        });

        // Goal counts — tasks in projects belonging to the goal
        document.querySelectorAll("[data-count-goal]").forEach((el) => {
            const goalId = Number(el.dataset.countGoal);
            const projectIds = new Set(
                this.projects.filter((p) => p.goal_id === goalId).map((p) => p.id)
            );
            const count = activeTodos.filter(
                (t) => t.project_id && projectIds.has(t.project_id)
            ).length;
            el.textContent = count > 0 ? String(count) : "";
        });

        // Project counts
        document.querySelectorAll("[data-count-project]").forEach((el) => {
            const projectId = Number(el.dataset.countProject);
            const count = activeTodos.filter((t) => t.project_id === projectId).length;
            el.textContent = count > 0 ? String(count) : "";
        });
    }

    // --- Date Picker ---

    _setModalDateField(inputEl, dateStr) {
        inputEl.dataset.date = dateStr;
        inputEl.value = dateStr ? this._dpFormatDisplay(dateStr) : "";
    }

    _dpFormatDisplay(dateStr) {
        if (!dateStr) return "";
        const MONTHS = ["jan.", "feb.", "mrt.", "apr.", "mei", "jun.", "jul.", "aug.", "sep.", "okt.", "nov.", "dec."];
        const [y, m, d] = dateStr.split("-");
        return `${parseInt(d)} ${MONTHS[parseInt(m) - 1]} ${y}`;
    }

    _openModalDatePicker(inputEl) {
        const fieldMap = {
            "modal-planned-date": "planned_date",
            "modal-start-date": "start_date",
            "modal-deadline": "deadline",
        };
        const field = fieldMap[inputEl.id];
        if (!field) return;
        // Use the visible .modal-field row as the anchor since the input may be display:none
        const anchor = inputEl.closest(".modal-field") || inputEl;
        this.openDatePicker(inputEl, field, anchor);
    }

    openDatePicker(inputEl, field, anchor) {
        this._dpTarget = inputEl;
        this._dpTargetField = field;
        const current = inputEl.dataset.date;
        if (current) {
            const d = new Date(current);
            this._dpYear = d.getFullYear();
            this._dpMonth = d.getMonth();
        } else {
            const t = new Date();
            this._dpYear = t.getFullYear();
            this._dpMonth = t.getMonth();
        }
        if (current) {
            const [y, m, d] = current.split("-");
            this.dpTextInput.value = `${d}-${m}-${y}`;
        } else {
            this.dpTextInput.value = "";
        }
        this._renderDpCalendar();
        this._positionDatePicker(anchor || inputEl);
        this.datePicker.hidden = false;
    }

    closeDatePicker() {
        if (this.datePicker) this.datePicker.hidden = true;
        this._dpTarget = null;
        this._dpTargetField = null;
    }

    _positionDatePicker(anchorEl) {
        const rect = anchorEl.getBoundingClientRect();
        const dp = this.datePicker;
        dp.style.position = "fixed";
        dp.style.top = `${Math.min(rect.top, window.innerHeight - 400)}px`;
        const spaceRight = window.innerWidth - rect.right;
        if (spaceRight >= 290) {
            dp.style.left = `${rect.right + 8}px`;
        } else {
            dp.style.left = `${rect.left - 280 - 8}px`;
        }
    }

    _renderDpCalendar() {
        const MONTHS = ["januari", "februari", "maart", "april", "mei", "juni",
                        "juli", "augustus", "september", "oktober", "november", "december"];
        const MONTHS_SHORT = ["jan.", "feb.", "mrt.", "apr.", "mei", "jun.", "jul.", "aug.", "sep.", "okt.", "nov.", "dec."];
        const DOW = ["ma", "di", "wo", "do", "vr", "za", "zo"];

        this.dpMonthLabel.textContent = `${MONTHS_SHORT[this._dpMonth]} ${this._dpYear}`;

        const today = this.getToday();
        const selected = this._dpTarget?.dataset.date || null;

        const firstDow = (new Date(this._dpYear, this._dpMonth, 1).getDay() + 6) % 7; // Mon=0
        const daysInMonth = new Date(this._dpYear, this._dpMonth + 1, 0).getDate();
        const prevDays = new Date(this._dpYear, this._dpMonth, 0).getDate();

        let html = '<div class="dp-dow-row">';
        DOW.forEach((d) => { html += `<span class="dp-dow">${d}</span>`; });
        html += '</div><div class="dp-day-grid">';

        for (let i = 0; i < firstDow; i++) {
            html += `<button type="button" class="dp-day dp-day-other" disabled>${prevDays - firstDow + 1 + i}</button>`;
        }
        for (let d = 1; d <= daysInMonth; d++) {
            const mo = String(this._dpMonth + 1).padStart(2, "0");
            const dd = String(d).padStart(2, "0");
            const dateStr = `${this._dpYear}-${mo}-${dd}`;
            let cls = "dp-day";
            if (dateStr === today) cls += " dp-today";
            if (dateStr === selected) cls += " dp-selected";
            html += `<button type="button" class="${cls}" data-date="${dateStr}">${d}</button>`;
        }
        const total = Math.ceil((firstDow + daysInMonth) / 7) * 7;
        for (let i = firstDow + daysInMonth, n = 1; i < total; i++, n++) {
            html += `<button type="button" class="dp-day dp-day-other" disabled>${n}</button>`;
        }
        html += '</div>';
        this.dpGrid.innerHTML = html;
    }

    _dpCommitDate(dateStr) {
        if (!this._dpTarget) return;
        this._setModalDateField(this._dpTarget, dateStr || "");
        this._syncModalFieldStates();
        if (this._dpTargetField) {
            this.saveModalField(this._dpTargetField, dateStr || null);
        }
        if (dateStr) this.closeDatePicker();
    }

    _syncModalRecurrenceVisibility() {
        const hasUnit = !!this.modalRecurrenceUnit.value;
        this.modalRecurrenceInterval.hidden = !hasUnit;
        this.modalRecurrenceEnd.hidden = !hasUnit;
        if (!hasUnit) {
            this.modalRecurrenceInterval.value = "";
            this.modalRecurrenceEnd.value = "";
        }
    }

    async _saveModalRecurrence() {
        if (!this.openTodoId) return;
        const unit = this.modalRecurrenceUnit.value || null;
        const interval = unit && this.modalRecurrenceInterval.value ? Number(this.modalRecurrenceInterval.value) : null;
        const end = unit && this.modalRecurrenceEnd.value ? this.modalRecurrenceEnd.value : null;
        this.setStatus("");
        try {
            const data = await this.request(`/api/todos/${this.openTodoId}`, {
                method: "PATCH",
                body: JSON.stringify({
                    recurrence_interval: interval,
                    recurrence_unit: unit,
                    recurrence_end: end,
                }),
            });
            if (data.todo) {
                this.applyTodoUpdate(data.todo);
                this.renderTodos();
            }
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    escapeHtml(text) {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    // --- Calendar (Apple Calendar via ICS subscriptions) ---

    async loadCalendarSubscriptions() {
        try {
            const data = await this.request("/api/calendar/subscriptions");
            this.calendarSubscriptions = data.subscriptions || [];
            this.renderCalendarSidebar();
        } catch (error) {
            console.warn("loadCalendarSubscriptions failed", error);
        }
    }

    renderCalendarSidebar() {
        if (!this.calendarNav) return;
        if (this.calendarSubscriptions.length === 0) {
            this.calendarNav.innerHTML = `<p class="sidebar-empty-hint">Nog geen agenda's. Voeg er één toe.</p>`;
            return;
        }
        this.calendarNav.innerHTML = this.calendarSubscriptions
            .map((sub) => {
                const area = sub.area_id
                    ? this.areas.find((a) => a.id === sub.area_id)
                    : null;
                const color = (area && area.color) || sub.color || "#0288D1";
                const errorTitle = sub.last_error
                    ? ` title="${this.escapeHtml(sub.last_error)}"`
                    : "";
                const errorBadge = sub.last_error
                    ? `<span class="calendar-sub-error" aria-label="Synchronisatiefout"${errorTitle}>!</span>`
                    : "";
                const areaBadge = area
                    ? `<span class="calendar-sub-area">${this.escapeHtml(area.name)}</span>`
                    : "";
                return `
                    <div class="calendar-sub-item" data-id="${sub.id}"${errorTitle}>
                        <span class="calendar-sub-swatch" style="background:${this.escapeHtml(color)}"></span>
                        <span class="calendar-sub-name">${this.escapeHtml(sub.name)}</span>
                        ${areaBadge}
                        ${errorBadge}
                        <button class="calendar-sub-sync" data-id="${sub.id}" type="button" title="Nu synchroniseren" aria-label="Nu synchroniseren">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="23 4 23 10 17 10"/>
                                <polyline points="1 20 1 14 7 14"/>
                                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                            </svg>
                        </button>
                        <button class="calendar-sub-delete" data-id="${sub.id}" type="button" title="Verwijderen" aria-label="Verwijderen">
                            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                            </svg>
                        </button>
                    </div>
                `;
            })
            .join("");
    }

    openCalendarModal(subscriptionId = null) {
        if (!this.calendarModal) return;
        const sub = subscriptionId
            ? this.calendarSubscriptions.find((s) => s.id === subscriptionId)
            : null;
        this.editingCalendarSubscriptionId = sub ? sub.id : null;
        this._populateCalendarAreaSelect(sub ? sub.area_id : null);
        if (sub) {
            this.calendarModalTitle.textContent = "Agenda bewerken";
            this.calendarNameInput.value = sub.name || "";
            this.calendarUrlInput.value = sub.url || "";
            this.calendarColorInput.value = sub.color || "#0288D1";
        } else {
            this.calendarModalTitle.textContent = "Agenda toevoegen";
            this.calendarNameInput.value = "";
            this.calendarUrlInput.value = "";
            this.calendarColorInput.value = "#0288D1";
        }
        this._updateCalendarColorVisibility();
        this.calendarModalError.hidden = true;
        this.calendarModalError.textContent = "";
        this.calendarModal.hidden = false;
        setTimeout(() => this.calendarNameInput.focus(), 0);
    }

    closeCalendarModal() {
        if (this.calendarModal) this.calendarModal.hidden = true;
        this.editingCalendarSubscriptionId = null;
    }

    _populateCalendarAreaSelect(selectedId) {
        if (!this.calendarAreaSelect) return;
        const activeAreas = this.areas.filter((a) => a.status === "active");
        const options = ['<option value="">— Geen gebied —</option>'];
        for (const area of activeAreas) {
            const selected = String(area.id) === String(selectedId) ? " selected" : "";
            options.push(
                `<option value="${area.id}"${selected}>${this.escapeHtml(area.name)}</option>`,
            );
        }
        this.calendarAreaSelect.innerHTML = options.join("");
    }

    _updateCalendarColorVisibility() {
        if (!this.calendarColorField || !this.calendarAreaSelect) return;
        this.calendarColorField.hidden = !!this.calendarAreaSelect.value;
    }

    async saveCalendarSubscription() {
        const name = (this.calendarNameInput.value || "").trim();
        const url = (this.calendarUrlInput.value || "").trim();
        const color = this.calendarColorInput.value || null;
        const areaValue = this.calendarAreaSelect ? this.calendarAreaSelect.value : "";
        const area_id = areaValue ? Number(areaValue) : null;
        if (!name || !url) {
            this.calendarModalError.textContent = "Naam en URL zijn verplicht.";
            this.calendarModalError.hidden = false;
            return;
        }
        this.calendarModalSave.disabled = true;
        try {
            const editingId = this.editingCalendarSubscriptionId;
            if (editingId) {
                await this.request(`/api/calendar/subscriptions/${editingId}`, {
                    method: "PATCH",
                    body: JSON.stringify({ name, url, color, area_id }),
                });
                this.closeCalendarModal();
                await this.loadCalendarSubscriptions();
                this.calendarEventsByRange.clear();
                this._refreshCalendarEventsForCurrentView();
                this.setStatus("Agenda bijgewerkt.");
            } else {
                const data = await this.request("/api/calendar/subscriptions", {
                    method: "POST",
                    body: JSON.stringify({ name, url, color, area_id }),
                });
                this.closeCalendarModal();
                await this.loadCalendarSubscriptions();
                if (data.sync_error) {
                    this.setStatus(`Agenda toegevoegd, maar sync gaf een fout: ${data.sync_error}`);
                } else {
                    this.setStatus("Agenda toegevoegd.");
                }
                this._refreshCalendarEventsForCurrentView();
            }
        } catch (error) {
            this.calendarModalError.textContent =
                error.message || "Kon agenda niet opslaan.";
            this.calendarModalError.hidden = false;
        } finally {
            this.calendarModalSave.disabled = false;
        }
    }

    async deleteCalendarSubscription(id) {
        try {
            await this.request(`/api/calendar/subscriptions/${id}`, { method: "DELETE" });
            await this.loadCalendarSubscriptions();
            this.calendarEventsByRange.clear();
            this._refreshCalendarEventsForCurrentView();
            this.setStatus("Agenda verwijderd.");
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    async syncCalendarSubscription(id) {
        try {
            const data = await this.request(`/api/calendar/subscriptions/${id}/sync`, { method: "POST" });
            await this.loadCalendarSubscriptions();
            this.calendarEventsByRange.clear();
            this._refreshCalendarEventsForCurrentView();
            if (data.sync_error) {
                this.setStatus(`Sync mislukt: ${data.sync_error}`);
            } else {
                this.setStatus("Agenda gesynchroniseerd.");
            }
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    _refreshCalendarEventsForCurrentView() {
        if (this.currentView.type === "view" &&
            (this.currentView.value === "week" || this.currentView.value === "next-week")) {
            const offset = this.currentView.value === "next-week" ? 1 : 0;
            const range = this.getWeekRange(offset);
            this.calendarEventsByRange.delete(`${range.start}|${range.end}`);
            this.loadCalendarEvents(range.start, range.end).then(() => this.renderTodos());
        }
        if (this._isTodayView() && this.todayAgendaOpen) {
            this.refreshTodayAgenda(true);
        }
    }

    async loadCalendarEvents(startDate, endDate) {
        const key = `${startDate}|${endDate}`;
        if (this.calendarEventsByRange.has(key)) {
            return this.calendarEventsByRange.get(key);
        }
        try {
            const data = await this.request(
                `/api/calendar/events?from=${encodeURIComponent(startDate)}&to=${encodeURIComponent(endDate)}`
            );
            const events = data.events || [];
            this.calendarEventsByRange.set(key, events);
            return events;
        } catch (error) {
            console.warn("loadCalendarEvents failed", error);
            this.calendarEventsByRange.set(key, []);
            return [];
        }
    }

    _formatEventTime(event) {
        if (event.all_day) return "Hele dag";
        const start = new Date(event.start_at);
        const end = new Date(event.end_at);
        const fmt = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
        return `${fmt(start)}–${fmt(end)}`;
    }

    _eventDateKey(event) {
        // Group events by their local-date start.
        const d = new Date(event.start_at);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }


    // ── Timer / pomodoro ────────────────────────────────────────────────

    async refreshActiveSession() {
        try {
            const data = await this.request("/api/timer/active");
            this._setActiveSession(data.active);
        } catch (error) {
            // Silent — timer is non-critical at boot.
            console.warn("refreshActiveSession failed", error);
        }
    }

    async loadPomodoroSettings() {
        try {
            const data = await this.request("/api/pomodoro/settings");
            this.pomodoroSettings = data.settings || null;
        } catch (error) {
            console.warn("loadPomodoroSettings failed", error);
        }
    }

    _setActiveSession(active) {
        this.activeSession = active || null;
        this._renderTimerPill();
        this._renderFocusWidget();
        this._startPillTickIfNeeded();
        // If the modal is open for the active task, refresh its action buttons.
        if (this.openTodoId) {
            const todo = this.todos.find((t) => t.id === this.openTodoId);
            if (todo) this._renderModalTimeSection(todo);
        }
    }

    _startPillTickIfNeeded() {
        if (this._pillTickHandle) {
            clearInterval(this._pillTickHandle);
            this._pillTickHandle = null;
        }
        if (!this.activeSession) return;
        this._pillTickHandle = setInterval(() => this._onPillTick(), 1000);
    }

    _onPillTick() {
        if (!this.activeSession) return;
        const startedMs = Date.parse(this.activeSession.started_at);
        if (Number.isNaN(startedMs)) return;
        const elapsed = Math.floor((Date.now() - startedMs) / 1000);
        const phase = this.activeSession.phase_seconds;
        if (Number(this.openTodoId) === Number(this.activeSession.task_id)) {
            this._paintModalLiveClock();
        }
        if (phase) {
            const remaining = phase - elapsed;
            this.timerPillClock.textContent = this._formatClock(Math.max(0, remaining));
            if (this.focusClock) {
                this.focusClock.textContent = this._formatClock(Math.max(0, remaining));
                if (this.focusProgress) {
                    const pct = Math.min(100, Math.round((elapsed / phase) * 100));
                    this.focusProgress.querySelector("i").style.width = `${pct}%`;
                }
            }
            if (remaining <= 0) {
                // Pause ticker until server confirms transition (avoids spamming /advance).
                clearInterval(this._pillTickHandle);
                this._pillTickHandle = null;
                this._chime();
                this._notify("Fase voltooid", this._phaseLabel(this.activeSession.kind));
                this.advancePomodoro();
            }
        } else {
            this.timerPillClock.textContent = this._formatClock(elapsed);
            if (this.focusClock) this.focusClock.textContent = this._formatClock(elapsed);
        }
    }

    _renderTimerPill() {
        if (!this.timerPill) return;
        if (!this.activeSession) {
            this.timerPill.hidden = true;
            return;
        }
        const a = this.activeSession;
        const taskTitle = (() => {
            const t = this.todos.find((td) => Number(td.id) === Number(a.task_id));
            return t ? t.title : "(geen taak)";
        })();
        this.timerPill.hidden = false;
        this.timerPill.classList.remove(
            "is-stopwatch", "is-focus", "is-short-break", "is-long-break"
        );
        let phaseLabel = "Stopwatch";
        let kindClass = "is-stopwatch";
        let showSkip = false;
        let showCycles = false;
        if (a.kind === "pomodoro_focus") {
            phaseLabel = "Focus"; kindClass = "is-focus"; showSkip = true; showCycles = true;
        } else if (a.kind === "pomodoro_short_break") {
            phaseLabel = "Korte pauze"; kindClass = "is-short-break"; showSkip = true;
        } else if (a.kind === "pomodoro_long_break") {
            phaseLabel = "Lange pauze"; kindClass = "is-long-break"; showSkip = true;
        }
        this.timerPill.classList.add(kindClass);
        this.timerPillPhase.textContent = phaseLabel;
        this.timerPillTask.textContent = taskTitle;
        this.timerPillSkip.hidden = !showSkip;

        if (showCycles && this.pomodoroSettings) {
            const total = Number(this.pomodoroSettings.cycles_per_long_break || 4);
            const idx = Number(a.cycle_index || 1);
            let dots = "";
            for (let i = 1; i <= total; i++) {
                dots += i <= idx ? "●" : "○";
            }
            this.timerPillCycles.textContent = dots;
            this.timerPillCycles.hidden = false;
        } else {
            this.timerPillCycles.hidden = true;
        }

        // Initial clock paint
        const startedMs = Date.parse(a.started_at);
        const elapsed = Math.floor((Date.now() - startedMs) / 1000);
        if (a.phase_seconds) {
            const remaining = Math.max(0, a.phase_seconds - elapsed);
            this.timerPillClock.textContent = this._formatClock(remaining);
        } else {
            this.timerPillClock.textContent = this._formatClock(Math.max(0, elapsed));
        }
    }

    _formatClock(totalSeconds) {
        const s = Math.max(0, Math.floor(totalSeconds));
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        const pad = (n) => String(n).padStart(2, "0");
        if (h > 0) return `${h}:${pad(m)}:${pad(sec)}`;
        return `${pad(m)}:${pad(sec)}`;
    }

    _paintModalLiveClock() {
        if (!this.modalTimeTotal || !this.activeSession) return;
        const startedMs = Date.parse(this.activeSession.started_at);
        if (Number.isNaN(startedMs)) return;
        const elapsed = Math.floor((Date.now() - startedMs) / 1000);
        const phase = this.activeSession.phase_seconds;
        const seconds = phase ? Math.max(0, phase - elapsed) : elapsed;
        // Pomodoro phases never exceed an hour, so strip hours entirely.
        const m = Math.floor(seconds / 60);
        const sec = seconds % 60;
        const pad = (n) => String(n).padStart(2, "0");
        this.modalTimeTotal.textContent = `${pad(m)}:${pad(sec)}`;
    }

    _phaseLabel(kind) {
        switch (kind) {
            case "pomodoro_focus": return "Focus";
            case "pomodoro_short_break": return "Korte pauze";
            case "pomodoro_long_break": return "Lange pauze";
            default: return "Stopwatch";
        }
    }

    async startStopwatch(taskId) {
        try {
            const data = await this.request("/api/timer/stopwatch/start", {
                method: "POST",
                body: JSON.stringify({ task_id: taskId }),
            });
            this._setActiveSession(data.active);
            this.setStatus("Stopwatch gestart");
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    async startPomodoro(taskId) {
        try {
            const data = await this.request("/api/timer/pomodoro/start", {
                method: "POST",
                body: JSON.stringify({ task_id: taskId }),
            });
            if (data.settings) this.pomodoroSettings = data.settings;
            this._setActiveSession(data.active);
            this._maybeRequestNotificationPermission();
            this.setStatus("Pomodoro gestart");
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    async stopActiveTimer() {
        if (!this.activeSession) return;
        const isPomodoro = this.activeSession.kind !== "stopwatch";
        const url = isPomodoro
            ? "/api/timer/pomodoro/stop"
            : "/api/timer/stopwatch/stop";
        try {
            await this.request(url, { method: "POST" });
            const taskId = this.activeSession.task_id;
            this._setActiveSession(null);
            // Refresh entries cache for the task that was being timed.
            if (taskId) this.timeEntriesByTask.delete(Number(taskId));
            this.setStatus("Timer gestopt");
            // If modal open on the same task, refresh its time section + total.
            if (this.openTodoId) {
                const todo = this.todos.find((t) => t.id === this.openTodoId);
                if (todo) this._renderModalTimeSection(todo);
            }
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    async skipPomodoroPhase() {
        if (!this.activeSession) return;
        try {
            const data = await this.request("/api/timer/pomodoro/skip", {
                method: "POST",
            });
            if (data.settings) this.pomodoroSettings = data.settings;
            this._setActiveSession(data.active);
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    async advancePomodoro() {
        try {
            const data = await this.request("/api/timer/pomodoro/advance", {
                method: "POST",
            });
            if (data.settings) this.pomodoroSettings = data.settings;
            this._setActiveSession(data.active);
        } catch (error) {
            console.warn("advancePomodoro failed", error);
        }
    }

    async _renderModalTimeSection(todo) {
        if (!this.modalTimeField || !todo) return;
        const taskId = Number(todo.id);
        const isActive = Number(this.activeSession?.task_id) === taskId;

        // Action button visibility: Start when idle; Pause + Stop when active.
        if (isActive) {
            this.modalStartPomodoro.hidden = true;
            this.modalPauseTimer.hidden = false;
            this.modalStopTimer.hidden = false;
        } else {
            this.modalStartPomodoro.hidden = false;
            this.modalPauseTimer.hidden = true;
            this.modalStopTimer.hidden = true;
        }

        // Fetch entries (cached per task)
        let entries = this.timeEntriesByTask.get(taskId);
        if (!entries) {
            try {
                const data = await this.request(`/api/timer/entries?task_id=${taskId}&limit=10`);
                entries = data.entries || [];
                this.timeEntriesByTask.set(taskId, entries);
            } catch (error) {
                entries = [];
            }
        }
        // Aggregate
        let totalSec = 0;
        let pomodoros = 0;
        entries.forEach((e) => {
            totalSec += Number(e.duration_seconds || 0);
            if (e.kind === "pomodoro_focus") pomodoros += 1;
        });
        if (isActive) {
            // Live countdown (mm:ss) while a session is running on this task.
            this._paintModalLiveClock();
        } else {
            this.modalTimeTotal.textContent = this._formatTotal(totalSec);
        }
        this.modalTimePomodoros.textContent =
            pomodoros > 0 ? `· ${pomodoros} pomodoro${pomodoros === 1 ? "" : "s"}` : "";

        // Recent entries list (last 5)
        if (entries.length === 0) {
            this.modalTimeEntries.innerHTML = "";
        } else {
            this.modalTimeEntries.innerHTML = entries.slice(0, 5).map((e) => {
                const startDt = new Date(e.started_at);
                const dateStr = startDt.toLocaleDateString("nl-NL", {
                    day: "2-digit", month: "short",
                });
                const timeStr = startDt.toLocaleTimeString("nl-NL", {
                    hour: "2-digit", minute: "2-digit",
                });
                const dur = this._formatTotal(Number(e.duration_seconds || 0));
                const icon = e.kind === "stopwatch" ? "⏱" :
                             e.kind === "pomodoro_focus" ? "🍅" :
                             e.kind === "pomodoro_short_break" ? "☕" : "🌴";
                return `<li class="modal-time-entry">
                    <span class="modal-time-entry-icon" aria-hidden="true">${icon}</span>
                    <span class="modal-time-entry-when">${this.escapeHtml(dateStr)} ${this.escapeHtml(timeStr)}</span>
                    <span class="modal-time-entry-dur">${this.escapeHtml(dur)}</span>
                </li>`;
            }).join("");
        }
    }

    _autoResizeTextarea(el) {
        el.style.height = "auto";
        el.style.height = el.scrollHeight + "px";
    }

    _formatTotal(totalSeconds) {
        const s = Math.max(0, Math.floor(totalSeconds));
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        if (h > 0) return `${h}u ${m}m`;
        return `${m} min`;
    }

    // ── Notifications + chime ───────────────────────────────────────────

    _maybeRequestNotificationPermission() {
        if (this._notifyAsked) return;
        this._notifyAsked = true;
        if ("Notification" in window && Notification.permission === "default") {
            try { Notification.requestPermission(); } catch { /* ignore */ }
        }
    }

    _notify(title, body) {
        if (!("Notification" in window)) return;
        if (Notification.permission !== "granted") return;
        try {
            new Notification(title, { body, silent: false });
        } catch { /* ignore */ }
    }

    _chime() {
        const enabled = this.pomodoroSettings?.sound_enabled !== false;
        if (!enabled) return;
        // Try the bundled MP3 first; fall back to a WebAudio beep if missing.
        if (this.timerChime && this.timerChime.src) {
            this.timerChime.currentTime = 0;
            const playPromise = this.timerChime.play();
            if (playPromise && typeof playPromise.catch === "function") {
                playPromise.catch(() => this._chimeBeep());
            }
            return;
        }
        this._chimeBeep();
    }

    _chimeBeep() {
        try {
            if (!this._chimeAudioCtx) {
                const Ctx = window.AudioContext || window.webkitAudioContext;
                if (!Ctx) return;
                this._chimeAudioCtx = new Ctx();
            }
            const ctx = this._chimeAudioCtx;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain).connect(ctx.destination);
            osc.frequency.value = 880;
            gain.gain.setValueAtTime(0.0001, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
            osc.start();
            osc.stop(ctx.currentTime + 0.5);
        } catch { /* ignore */ }
    }

    // ── Pomodoro settings modal ─────────────────────────────────────────

    openPomodoroSettingsModal() {
        if (!this.pomodoroSettingsModal) return;
        const s = this.pomodoroSettings || {};
        this.pomoFocusMinutes.value = s.focus_minutes ?? 25;
        this.pomoShortBreakMinutes.value = s.short_break_minutes ?? 5;
        this.pomoLongBreakMinutes.value = s.long_break_minutes ?? 15;
        this.pomoCyclesPerLongBreak.value = s.cycles_per_long_break ?? 4;
        this.pomoAutoStartBreaks.checked = s.auto_start_breaks !== false;
        this.pomoAutoStartFocus.checked = s.auto_start_focus === true;
        this.pomoSoundEnabled.checked = s.sound_enabled !== false;
        this.pomodoroSettingsModal.hidden = false;
    }

    closePomodoroSettingsModal() {
        if (this.pomodoroSettingsModal) this.pomodoroSettingsModal.hidden = true;
    }

    async savePomodoroSettings() {
        const payload = {
            focus_minutes: Number(this.pomoFocusMinutes.value) || 25,
            short_break_minutes: Number(this.pomoShortBreakMinutes.value) || 5,
            long_break_minutes: Number(this.pomoLongBreakMinutes.value) || 15,
            cycles_per_long_break: Number(this.pomoCyclesPerLongBreak.value) || 4,
            auto_start_breaks: this.pomoAutoStartBreaks.checked,
            auto_start_focus: this.pomoAutoStartFocus.checked,
            sound_enabled: this.pomoSoundEnabled.checked,
        };
        try {
            const data = await this.request("/api/pomodoro/settings", {
                method: "PATCH",
                body: JSON.stringify(payload),
            });
            this.pomodoroSettings = data.settings || payload;
            this.closePomodoroSettingsModal();
            this.setStatus("Instellingen opgeslagen");
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    // ── Stats view ──────────────────────────────────────────────────────

    async renderStats() {
        if (!this.statsView) return;
        const { start, end } = this.getStatsRange();
        // Update header label
        if (this.statsRangeLabel) {
            const fmt = (s) => {
                const d = new Date(`${s}T00:00:00`);
                return d.toLocaleDateString("nl-NL", { day: "2-digit", month: "short" });
            };
            this.statsRangeLabel.textContent = `${fmt(start)} – ${fmt(end)}`;
        }
        // Fetch the four summaries in parallel.
        let day, area, project, task;
        try {
            [day, area, project, task] = await Promise.all([
                this._fetchSummary(start, end, "day"),
                this._fetchSummary(start, end, "area"),
                this._fetchSummary(start, end, "project"),
                this._fetchSummary(start, end, "task"),
            ]);
        } catch (error) {
            this.setStatus(error.message);
            return;
        }
        // Filter rows by kind if needed (server returns all kinds).
        // For chart by day we use the day breakdown directly; for kind-filter
        // we re-fetch entries — but a simpler approach: fetch entries once and
        // aggregate client-side. Keep the simple server-aggregate path for now;
        // the kind filter just hides pomodoro_count vs total_seconds where appropriate.
        const totalSec = day.reduce((s, r) => s + Number(r.total_seconds || 0), 0);
        const totalPomo = day.reduce((s, r) => s + Number(r.pomodoro_count || 0), 0);
        // Rough session count: use task summary length as a stand-in.
        let totalSessions = 0;
        try {
            const entriesData = await this.request(`/api/timer/entries?from=${start}&to=${end}&limit=500`);
            const entries = entriesData.entries || [];
            const filtered = entries.filter((e) => {
                if (this.statsKindFilter === "all") return true;
                if (this.statsKindFilter === "stopwatch") return e.kind === "stopwatch";
                return e.kind && e.kind.startsWith("pomodoro_");
            });
            totalSessions = filtered.length;
        } catch {
            totalSessions = 0;
        }
        this.statsTotalTime.textContent = this._formatTotal(totalSec);
        this.statsTotalPomodoros.textContent = String(totalPomo);
        this.statsTotalSessions.textContent = String(totalSessions);

        this._renderStatsChart(day, start, end);
        this._renderStatsBreakdown(this.statsByArea, area, totalSec);
        this._renderStatsBreakdown(this.statsByProject, project, totalSec);
        this._renderStatsBreakdown(this.statsByTask, task.slice(0, 10), totalSec);
    }

    async _fetchSummary(from, to, groupBy) {
        const data = await this.request(
            `/api/timer/summary?from=${from}&to=${to}&group_by=${groupBy}`
        );
        return data.rows || [];
    }

    getStatsRange() {
        const { start, end } = this.getWeekRange(this.statsRangeOffset);
        return { start, end };
    }

    _renderStatsChart(dayRows, start, end) {
        if (!this.statsChart) return;
        // Build a 7-day array spanning [start, end] so empty days show a baseline.
        const days = [];
        const cursor = new Date(`${start}T00:00:00`);
        const endDate = new Date(`${end}T00:00:00`);
        while (cursor <= endDate) {
            const key = cursor.toISOString().split("T")[0];
            const row = dayRows.find((r) => r.key === key);
            days.push({
                key,
                label: cursor.toLocaleDateString("nl-NL", { weekday: "short" }),
                total: row ? Number(row.total_seconds || 0) : 0,
            });
            cursor.setDate(cursor.getDate() + 1);
        }
        const maxSec = Math.max(1, ...days.map((d) => d.total));
        const W = 700, H = 200, paddingLeft = 36, paddingBottom = 24, paddingTop = 8;
        const innerW = W - paddingLeft - 8;
        const innerH = H - paddingBottom - paddingTop;
        const barWidth = innerW / days.length * 0.65;
        const slot = innerW / days.length;
        const yAxisLabel = (sec) => {
            if (sec >= 3600) return `${Math.round(sec / 3600)}u`;
            return `${Math.round(sec / 60)}m`;
        };
        const baseY = paddingTop + innerH;
        let svg = "";
        // Y-axis ticks (3 ticks)
        for (let i = 0; i <= 2; i++) {
            const y = paddingTop + (innerH * (1 - i / 2));
            const v = (maxSec * i) / 2;
            svg += `<line x1="${paddingLeft}" y1="${y}" x2="${W - 4}" y2="${y}" class="stats-grid-line"/>`;
            svg += `<text x="${paddingLeft - 6}" y="${y + 3}" class="stats-axis-label" text-anchor="end">${yAxisLabel(v)}</text>`;
        }
        // Bars
        days.forEach((d, i) => {
            const x = paddingLeft + slot * i + (slot - barWidth) / 2;
            const h = innerH * (d.total / maxSec);
            const y = baseY - h;
            svg += `<rect x="${x}" y="${y}" width="${barWidth}" height="${Math.max(2, h)}" rx="3" class="stats-bar"><title>${this._formatTotal(d.total)}</title></rect>`;
            svg += `<text x="${x + barWidth / 2}" y="${baseY + 16}" class="stats-axis-label" text-anchor="middle">${d.label}</text>`;
        });
        this.statsChart.innerHTML = svg;
        if (this.statsChartLegend) this.statsChartLegend.textContent = "";
    }

    _renderStatsBreakdown(container, rows, totalSec) {
        if (!container) return;
        if (!rows || rows.length === 0) {
            container.innerHTML = `<li class="stats-empty">Geen data.</li>`;
            return;
        }
        container.innerHTML = rows.map((r) => {
            const sec = Number(r.total_seconds || 0);
            const pct = totalSec > 0 ? Math.round((sec / totalSec) * 100) : 0;
            return `<li class="stats-row">
                <div class="stats-row-head">
                    <span class="stats-row-label">${this.escapeHtml(r.label || "?")}</span>
                    <span class="stats-row-value">${this.escapeHtml(this._formatTotal(sec))} · ${pct}%</span>
                </div>
                <div class="stats-row-bar"><div class="stats-row-bar-fill" style="width:${pct}%"></div></div>
            </li>`;
        }).join("");
    }

    async refreshTodayAgenda(force = false) {
        if (!this.todayAgendaList) return;
        const today = this._tbActiveDateKey ? this._tbActiveDateKey() : this.getToday();
        if (force) this.calendarEventsByRange.delete(`${today}|${today}`);
        const events = await this.loadCalendarEvents(today, today);
        const sameDay = events
            .filter((e) => this._eventDateKey(e) === today)
            .sort((a, b) => Date.parse(a.start_at) - Date.parse(b.start_at));

        if (this.todayAgendaTitle) {
            const DAYS = ["Zondag", "Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag"];
            const d = new Date(today);
            this.todayAgendaTitle.textContent = `${DAYS[d.getDay()]} ${this._dpFormatDisplay(today)}`;
        }
        this._renderAgendaNow();

        if (sameDay.length === 0) {
            this.todayAgendaList.innerHTML = `<li class="agenda-empty">Geen afspraken vandaag.</li>`;
        } else {
            const now = Date.now();
            this.todayAgendaList.innerHTML = sameDay.map((e) => {
                const color = e.subscription_color || "var(--ink-tertiary)";
                const start = Date.parse(e.start_at);
                const end = Date.parse(e.end_at);
                const isNow = !e.all_day && now >= start && now < end;
                const time = e.all_day
                    ? `<b>Hele</b>dag`
                    : `<b>${this._fmtHm(start)}</b>${this._fmtHm(end)}`;
                const subtitle = e.location || e.subscription_name || "";
                return `
                    <li class="agenda-item${isNow ? " is-now" : ""}">
                        <div class="agenda-time">${time}</div>
                        <div class="agenda-bar" style="background:${this.escapeHtml(color)}"></div>
                        <div class="agenda-info">
                            <div class="t">${this.escapeHtml(e.summary || "(geen titel)")}</div>
                            ${subtitle ? `<div class="s">${this.escapeHtml(subtitle)}</div>` : ""}
                        </div>
                    </li>
                `;
            }).join("");
        }

        this._renderFocusWidget();
        if (this._isTodayView?.()) this.renderTodaySchema();
    }

    _fmtHm(ms) {
        const d = new Date(ms);
        return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }

    _renderAgendaNow() {
        if (!this.agendaNowLabel) return;
        const d = new Date();
        this.agendaNowLabel.textContent = `Nu · ${this._fmtHm(d.getTime())}`;
    }

    // ── Next week view ──────────────────────────────────────────────────
    async renderNextWeekView() {
        if (!this.nextWeekView) return;
        const range = this.getWeekRange(this.nextWeekOffset);
        const startDate = new Date(range.start);

        const weekNo = this._isoWeekNumber(startDate);
        const sub = this.contentSubtitle || document.getElementById("contentSubtitle");
        if (sub) sub.textContent = "";
        if (this.nextWeekLabel) {
            this.nextWeekLabel.textContent = String(weekNo);
        }
        if (this.nextWeekPrevBtn) {
            this.nextWeekPrevBtn.disabled = this.nextWeekOffset <= 0;
        }

        // Load real calendar events and week availability in parallel.
        const [events, availabilityData] = await Promise.all([
            this.loadCalendarEvents(range.start, range.end),
            this.loadWeekAvailability(range.start),
        ]);

        // Update budget capacity from saved availability.
        const totalHours = Object.values(availabilityData).reduce((s, h) => s + h, 0);
        this.nextWeekBudgetCapacityMinutes = Math.round(totalHours * 60);
        if (this.nextWeekBudgetCapLabel) {
            const h = Math.floor(totalHours);
            const m = Math.round((totalHours - h) * 60);
            this.nextWeekBudgetCapLabel.textContent = m ? `${h}u ${m}m` : `${h}u`;
        }

        // Build per-day buckets.
        const dayKeys = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(startDate);
            d.setDate(startDate.getDate() + i);
            dayKeys.push(this._fmtDateKey(d));
        }
        const eventsByDay = new Map(dayKeys.map((k) => [k, []]));
        events.forEach((ev) => {
            const key = this._eventDateKey(ev);
            if (eventsByDay.has(key)) eventsByDay.get(key).push(ev);
        });
        const todosByDay = new Map(dayKeys.map((k) => [k, []]));
        this.todos.forEach((t) => {
            if (t.completed) return;
            if (!t.planned_date) return;
            if (todosByDay.has(t.planned_date)) todosByDay.get(t.planned_date).push(t);
        });

        // Aggregate stats.
        let totalItems = 0;
        let focusBlocks = 0;
        let focusMinutes = 0;
        let meetingMinutes = 0;
        const perDayMinutes = [];

        const dayHtmls = dayKeys.map((key, idx) => {
            const date = new Date(startDate);
            date.setDate(startDate.getDate() + idx);
            const dayEvents = eventsByDay.get(key).sort(
                (a, b) => Date.parse(a.start_at) - Date.parse(b.start_at)
            );
            const dayTodos = todosByDay.get(key).sort((a, b) => {
                const ta = this._timeToMinutes(a.planned_time);
                const tb = this._timeToMinutes(b.planned_time);
                return ta - tb;
            });

            // Sum minutes for this day.
            let dayMinutes = 0;
            dayEvents.forEach((ev) => {
                if (ev.all_day) return;
                const dur = (Date.parse(ev.end_at) - Date.parse(ev.start_at)) / 60000;
                dayMinutes += dur;
                meetingMinutes += dur;
            });
            dayTodos.forEach((t) => {
                const dur = Number(t.duration) || 0;
                dayMinutes += dur;
                focusMinutes += dur;
                if (dur > 0) focusBlocks += 1;
            });
            const itemCount = dayEvents.length + dayTodos.length;
            totalItems += itemCount;
            perDayMinutes.push(dayMinutes);

            // Combine + sort lines by start time.
            const lines = [
                ...dayEvents.map((ev) => ({ kind: "event", start: Date.parse(ev.start_at), payload: ev })),
                ...dayTodos.map((t) => ({
                    kind: "task",
                    start: this._timeToMinutes(t.planned_time) * 60000,
                    payload: t,
                })),
            ].sort((a, b) => a.start - b.start);

            const lineHtmls = lines.map((line) => this._renderNextWeekLine(line, key)).join("");
            const dayName = date.toLocaleDateString("nl-NL", { weekday: "long" });
            const dateNum = date.getDate();
            const isWeekend = date.getDay() === 0 || date.getDay() === 6;
            const lineupHtml = lineHtmls || `<div class="nw-day-empty">Geen items gepland.</div>`;
            const focusH = Math.floor(dayMinutes / 60);
            const focusM = Math.round(dayMinutes % 60);
            const focusLabel = focusH || focusM
                ? `${focusH}<small>u${focusM ? ` ${focusM}m` : ""}</small>`
                : `0<small>u</small>`;

            return `
                <div class="nw-day${isWeekend ? " weekend" : ""}">
                    <div class="nw-day-when">
                        <div class="nm">${this.escapeHtml(dayName)}<sup>${dateNum}</sup></div>
                    </div>
                    <div class="nw-day-lineup">${lineupHtml}</div>
                    <div class="nw-day-totals">
                        <span class="focus">${focusLabel}</span>
                    </div>
                </div>
            `;
        });

        if (this.nextWeekDays) {
            this.nextWeekDays.innerHTML = dayHtmls.join("")
                || `<div class="nw-days-empty">Geen geplande items voor volgende week.</div>`;
        }
        const itemCountEl = document.getElementById("nextWeekItemCount");
        if (itemCountEl) {
            itemCountEl.textContent = `${totalItems} ${totalItems === 1 ? "item" : "items"}`;
        }

        // Week strip.
        const maxDay = perDayMinutes.reduce((m, v) => Math.max(m, v), 0) || 1;
        const dayShortNames = ["Ma", "Di", "Wo", "Do", "Vr", "Za", "Zo"];
        if (this.nextWeekStrip) {
            this.nextWeekStrip.innerHTML = dayKeys.map((_, i) => {
                const d = new Date(startDate);
                d.setDate(startDate.getDate() + i);
                const mins = perDayMinutes[i];
                const pct = Math.round((mins / maxDay) * 100);
                const h = Math.floor(mins / 60);
                const m = Math.round(mins % 60);
                const hh = mins ? `${h}u${m ? ` ${m}m` : ""}` : "—";
                return `
                    <div class="nwd">
                        <span class="dn">${dayShortNames[i]}</span>
                        <span class="dt">${d.getDate()}</span>
                        <span class="bar"><i style="width:${pct}%;"></i></span>
                        <span class="hh">${hh}</span>
                    </div>
                `;
            }).join("");
        }

        if (this.nextWeekFootSummary) {
            this.nextWeekFootSummary.innerHTML =
                `<b>${totalItems} ${totalItems === 1 ? "item" : "items"}</b> · ` +
                `<b>${focusBlocks} focus-${focusBlocks === 1 ? "blok" : "blokken"}</b> · ` +
                `<b>${Math.floor(focusMinutes / 60)}u ${String(Math.round(focusMinutes % 60)).padStart(2, "0")}m</b> diep werk · ` +
                `<b>${Math.floor(meetingMinutes / 60)}u ${String(Math.round(meetingMinutes % 60)).padStart(2, "0")}m</b> meetings & afspraken`;
        }

        this._renderNextWeekBudget(events);
        this._renderNextWeekDeadlines(range.start, range.end);
    }

    // ── Plan week availability ───────────────────────────────────────────────

    async loadWeekAvailability(weekStart) {
        try {
            const data = await this.request(
                `/api/availability?week_start=${encodeURIComponent(weekStart)}`
            );
            return data.days || {};
        } catch (err) {
            console.warn("loadWeekAvailability failed", err);
            return {};
        }
    }

    openPlanWeekModal() {
        if (!this.planWeekModal) return;
        const range = this.getWeekRange(this.nextWeekOffset);
        const startDate = new Date(range.start);
        const weekNo = this._isoWeekNumber(startDate);
        const endDate = new Date(range.end);

        if (this.planWeekSub) {
            const fmt = (d) => `${d.getDate()} ${d.toLocaleDateString("nl-NL", { month: "short" })}`;
            this.planWeekSub.textContent =
                `Week ${weekNo} · ${fmt(startDate)} – ${fmt(endDate)} ${endDate.getFullYear()}`;
        }

        const dayNames = ["Maandag", "Dinsdag", "Woensdag", "Donderdag", "Vrijdag", "Zaterdag", "Zondag"];
        // Load current saved values (or defaults) then render rows.
        this.loadWeekAvailability(range.start).then((saved) => {
            if (!this.planWeekRows) return;
            const rows = [];
            for (let i = 0; i < 7; i++) {
                const d = new Date(startDate);
                d.setDate(startDate.getDate() + i);
                const key = this._fmtDateKey(d);
                const isWeekend = i >= 5;
                const defaultHours = saved[key] ?? (isWeekend ? 0 : 8);
                const dateLabel = d.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
                rows.push(`
                    <div class="pw-day-row${isWeekend ? " weekend" : ""}">
                        <div>
                            <div class="pw-day-name">${dayNames[i]}</div>
                            <div class="pw-day-date">${dateLabel}</div>
                        </div>
                        <div></div>
                        <div style="display:flex;align-items:center;gap:6px;">
                            <input type="number" class="pw-hours-input" data-day="${key}"
                                min="0" max="24" step="0.5" value="${defaultHours}">
                            <span class="pw-hours-label">u</span>
                        </div>
                    </div>
                `);
            }
            this.planWeekRows.innerHTML = rows.join("");
            this._updatePlanWeekTotal();
            this.planWeekRows.addEventListener("input", () => this._updatePlanWeekTotal());
        });

        this.planWeekModal.hidden = false;
    }

    _updatePlanWeekTotal() {
        if (!this.planWeekRows || !this.planWeekTotal) return;
        const inputs = this.planWeekRows.querySelectorAll(".pw-hours-input");
        let total = 0;
        inputs.forEach((inp) => { total += parseFloat(inp.value) || 0; });
        const h = Math.floor(total);
        const m = Math.round((total - h) * 60);
        this.planWeekTotal.textContent = m ? `${h}u ${m}m` : `${h}u`;
    }

    closePlanWeekModal() {
        if (this.planWeekModal) this.planWeekModal.hidden = true;
    }

    async savePlanWeekModal() {
        if (!this.planWeekRows || !this.planWeekSave) return;
        const range = this.getWeekRange(this.nextWeekOffset);
        const inputs = this.planWeekRows.querySelectorAll(".pw-hours-input");
        const days = {};
        inputs.forEach((inp) => {
            const day = inp.dataset.day;
            const val = parseFloat(inp.value);
            if (day) days[day] = isNaN(val) ? 0 : Math.min(24, Math.max(0, val));
        });

        this.planWeekSave.disabled = true;
        this.planWeekSave.textContent = "Opslaan…";
        try {
            await this.request("/api/availability", {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ week_start: range.start, days }),
            });
            this.closePlanWeekModal();
            // Re-render so the budget capacity updates immediately.
            await this.renderNextWeekView();
        } catch (err) {
            this.setStatus("Opslaan mislukt — probeer opnieuw.");
        } finally {
            this.planWeekSave.disabled = false;
            this.planWeekSave.textContent = "Opslaan";
        }
    }

    _renderNextWeekDeadlines(rangeStart, rangeEnd) {
        if (!this.nextWeekDeadlinesList) return;
        const weekdayShort = ["zo", "ma", "di", "wo", "do", "vr", "za"];
        const todayKey = this._fmtDateKey(this._startOfToday());
        const todayMs = this._startOfToday().getTime();

        const deadlines = this.todos
            .filter((t) => !t.completed && t.deadline
                && t.deadline >= rangeStart && t.deadline <= rangeEnd)
            .sort((a, b) => a.deadline.localeCompare(b.deadline));

        if (this.nextWeekDeadlinesSub) {
            this.nextWeekDeadlinesSub.textContent = deadlines.length === 0
                ? "Geen deadlines deze week."
                : `${deadlines.length} ${deadlines.length === 1 ? "niet-onderhandelbare datum" : "niet-onderhandelbare data"} deze week.`;
        }

        const escape = (s) => this.escapeHtml(s);
        const fmtDur = (mins) => {
            const h = Math.floor(mins / 60);
            const m = Math.round(mins % 60);
            if (h && m) return `${h}u ${m}m`;
            if (h) return `${h}u`;
            return `${m}m`;
        };

        const rows = deadlines.map((t, idx) => {
            const [y, m, d] = t.deadline.split("-").map((n) => parseInt(n, 10));
            const dateObj = new Date(y, m - 1, d);
            const day = dateObj.getDate();
            const wd = weekdayShort[dateObj.getDay()];
            const daysUntil = Math.round((dateObj.getTime() - todayMs) / 86400000);
            let tag;
            if (t.deadline === todayKey) tag = "vandaag";
            else if (daysUntil === 1) tag = "morgen";
            else if (daysUntil < 0) tag = `+ ${Math.abs(daysUntil)} dg te laat`;
            else tag = `— ${daysUntil} dg`;
            const area = this.areas.find((a) => a.id === t.area_id);
            const areaColor = area ? area.color : "var(--ink-tertiary)";
            const areaName = area ? area.name : "Geen gebied";

            // Focus-tijd status.
            const dur = Number(t.duration) || 0;
            const plannedDate = t.planned_date || "";
            const hasPlan = !!plannedDate && plannedDate <= t.deadline;
            const lateplan = !!plannedDate && plannedDate > t.deadline;
            let statusClass = "unscheduled";
            let statusLabel;
            if (hasPlan) {
                statusClass = "scheduled";
                const when = plannedDate === todayKey ? "vandaag" : `${plannedDate.slice(8, 10)}/${plannedDate.slice(5, 7)}`;
                statusLabel = dur > 0
                    ? `${fmtDur(dur)} gepland op ${when}`
                    : `gepland op ${when} (geen duur)`;
            } else if (lateplan) {
                statusClass = "late";
                statusLabel = `gepland NA deadline (${plannedDate.slice(8, 10)}/${plannedDate.slice(5, 7)})`;
            } else {
                statusLabel = dur > 0 ? `${fmtDur(dur)} nodig · plan tijd` : "plan tijd";
            }

            const urgent = idx === 0 && daysUntil <= 2;
            return `
                <div class="dl-row${urgent ? " urgent" : ""} ${statusClass}" data-todo-id="${t.id}" role="button" tabindex="0">
                    <div class="when">${day}<small>${wd}</small></div>
                    <div>
                        <div class="ti">${escape(t.title || "")}</div>
                        <div class="ms"><span class="dot" style="background:${escape(areaColor)}"></span>${escape(areaName)}</div>
                        <div class="dl-status ${statusClass}">${escape(statusLabel)}</div>
                    </div>
                    <span class="tag">${escape(tag)}</span>
                </div>
            `;
        });

        this.nextWeekDeadlinesList.innerHTML = rows.join("");
    }

    _renderNextWeekBudget(events) {
        if (!this.nextWeekBudgetBars && !this.nextWeekBudgetLegend) return;
        const categories = this.nextWeekBudgetCategories || [];
        const capacity = this.nextWeekBudgetCapacityMinutes || 0;
        const totals = new Map(categories.map((c) => [c.keyword, 0]));

        events.forEach((ev) => {
            if (ev.all_day) return;
            const desc = (ev.description || "").toUpperCase();
            if (!desc) return;
            const match = categories.find((c) => desc.includes(c.keyword.toUpperCase()));
            if (!match) return;
            const dur = (Date.parse(ev.end_at) - Date.parse(ev.start_at)) / 60000;
            if (!Number.isFinite(dur) || dur <= 0) return;
            totals.set(match.keyword, totals.get(match.keyword) + dur);
        });

        const used = Array.from(totals.values()).reduce((a, b) => a + b, 0);
        const freeMinutes = Math.max(0, capacity - used);

        const pct = (mins) => (capacity > 0 ? (mins / capacity) * 100 : 0);
        const fmt = (mins) => {
            const h = Math.floor(mins / 60);
            const m = Math.round(mins % 60);
            return `${h}u ${String(m).padStart(2, "0")}m`;
        };

        if (this.nextWeekBudgetBars) {
            const bars = categories
                .map((c) => {
                    const mins = totals.get(c.keyword) || 0;
                    if (mins <= 0) return "";
                    return `<i class="${c.className}" style="width:${pct(mins).toFixed(2)}%;"></i>`;
                })
                .join("");
            const freeBar = freeMinutes > 0
                ? `<i class="free" style="width:${pct(freeMinutes).toFixed(2)}%;"></i>`
                : "";
            this.nextWeekBudgetBars.innerHTML = bars + freeBar;
        }

        if (this.nextWeekBudgetLegend) {
            const items = categories.map((c) => {
                const mins = totals.get(c.keyword) || 0;
                return `<span><i style="background:${c.color};"></i>${this.escapeHtml(c.label)} <b>${fmt(mins)}</b></span>`;
            });
            items.push(
                `<span><i style="background:var(--border-strong);"></i>Vrij <b>${fmt(freeMinutes)}</b></span>`
            );
            this.nextWeekBudgetLegend.innerHTML = items.join("");
        }
    }

    _renderNextWeekLine(line, dayKey) {
        const escape = (s) => this.escapeHtml(s);
        if (line.kind === "event") {
            const ev = line.payload;
            const color = ev.subscription_color || "var(--ink-tertiary)";
            const time = ev.all_day
                ? `<b>Hele</b><span>dag</span>`
                : `<b>${this._fmtHm(Date.parse(ev.start_at))}</b><span>${this._fmtHm(Date.parse(ev.end_at))}</span>`;
            const subParts = [];
            if (ev.subscription_name) subParts.push(escape(ev.subscription_name));
            if (ev.location) subParts.push(escape(ev.location));
            const sub = subParts.length
                ? `<span class="dot" style="background:${escape(color)}"></span>${subParts.join(" · ")}`
                : `<span class="dot" style="background:${escape(color)}"></span>`;
            return `
                <div class="nw-line event">
                    <div class="t">${time}</div>
                    <div class="bar" style="background:${escape(color)};"></div>
                    <div class="body">
                        <div class="ti">${escape(ev.summary || "(geen titel)")}</div>
                        <div class="sub">${sub}</div>
                    </div>
                </div>
            `;
        }
        const t = line.payload;
        const area = this.areas.find((a) => a.id === t.area_id);
        const areaColor = area ? area.color : "var(--ink-tertiary)";
        const areaName = area ? escape(area.name) : "Geen gebied";
        const start = t.planned_time ? t.planned_time.slice(0, 5) : "—";
        const dur = Number(t.duration) || 0;
        const durLabel = dur >= 60
            ? `${Math.floor(dur / 60)}u${dur % 60 ? ` ${dur % 60}m` : ""}`
            : (dur ? `${dur}m` : "—");
        const isDeadlineToday = t.deadline === dayKey;
        const badge = isDeadlineToday
            ? `<span class="badge dl">Deadline</span>`
            : (dur >= 50 ? `<span class="badge">Focus</span>` : "");
        const barColor = isDeadlineToday ? "var(--danger)" : areaColor;
        return `
            <div class="nw-line task${isDeadlineToday ? " deadline" : ""}">
                <div class="t"><b>${escape(start)}</b><span>${escape(durLabel)}</span></div>
                <div class="bar" style="background:${escape(barColor)};"></div>
                <div class="body">
                    <div class="ti">${escape(t.title || "")}</div>
                    <div class="sub"><span class="dot" style="background:${escape(areaColor)}"></span>${areaName}</div>
                </div>
                ${badge}
            </div>
        `;
    }

    _fmtDateKey(d) {
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    }

    _startOfToday() {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d;
    }

    _timeToMinutes(value) {
        if (!value) return 24 * 60; // unscheduled → sort to end of day
        const [h, m] = String(value).split(":").map((n) => parseInt(n, 10));
        return (isNaN(h) ? 0 : h) * 60 + (isNaN(m) ? 0 : m);
    }

    _isoWeekNumber(date) {
        const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const dayNum = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
    }

    // ── Streaks ─────────────────────────────────────────────────────────
    _renderStreaks() {
        if (!this.streakWeek) return;
        const today = new Date();
        // Monday-based week index (0..6 = Mon..Sun)
        const todayIdx = (today.getDay() + 6) % 7;
        const weekStart = new Date(today);
        weekStart.setHours(0, 0, 0, 0);
        weekStart.setDate(weekStart.getDate() - todayIdx);

        // Set of YYYY-MM-DD strings for days with at least one completed todo this week.
        const doneByDay = new Set();
        let todayDoneCount = 0;
        for (const t of this.todos) {
            if (!t.completed) continue;
            const ts = t.completed_at || t.updated_at;
            if (!ts) continue;
            const dt = new Date(ts);
            if (dt < weekStart) continue;
            const key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
            doneByDay.add(key);
            if (key === this.getToday()) todayDoneCount++;
        }

        // Current streak: consecutive completed days ending at today (or yesterday if today not done yet).
        let streak = 0;
        const cursor = new Date(today);
        cursor.setHours(0, 0, 0, 0);
        const todayKey = this.getToday();
        if (!doneByDay.has(todayKey)) cursor.setDate(cursor.getDate() - 1);
        while (true) {
            const key = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, "0")}-${String(cursor.getDate()).padStart(2, "0")}`;
            if (this._dayHasCompleted(key)) {
                streak++;
                cursor.setDate(cursor.getDate() - 1);
            } else {
                break;
            }
        }

        if (this.streakDaysNum) {
            this.streakDaysNum.innerHTML = `${streak}<small>${streak === 1 ? "DAG" : "DAGEN"}</small>`;
        }
        if (this.streakTodayCount) {
            this.streakTodayCount.textContent = `${todayDoneCount} ${todayDoneCount === 1 ? "taak" : "taken"}`;
        }

        const labels = ["M", "D", "W", "D", "V", "Z", "Z"];
        const checkSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;
        this.streakWeek.innerHTML = labels.map((label, i) => {
            const d = new Date(weekStart);
            d.setDate(weekStart.getDate() + i);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
            const isFuture = d > today && key !== todayKey;
            const isDone = doneByDay.has(key);
            const isToday = i === todayIdx;
            const cls = ["streak-day"];
            if (isDone && !isFuture) cls.push("is-done");
            if (isToday) cls.push("is-today");
            return `<div class="${cls.join(" ")}"><div class="pip">${isDone ? checkSvg : ""}</div>${label}</div>`;
        }).join("");
    }

    _dayHasCompleted(key) {
        return this.todos.some((t) => {
            if (!t.completed) return false;
            const ts = t.completed_at || t.updated_at;
            if (!ts) return false;
            const dt = new Date(ts);
            const k = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
            return k === key;
        });
    }

    // ── Focus widget ────────────────────────────────────────────────────
    _renderFocusWidget() {
        if (!this.focusClock) return;
        const a = this.activeSession;
        if (!a) {
            this.focusClock.textContent = "00:00";
            this.focusTask.textContent = "Geen actieve sessie";
            if (this.focusProgress) this.focusProgress.querySelector("i").style.width = "0%";
            if (this.focusPanelLabel) this.focusPanelLabel.textContent = "Focus";
            this.focusPauseBtn.hidden = true;
            this.focusStopBtn.hidden = true;
            this.focusCycles.hidden = true;
            return;
        }
        const phaseLabel = this._phaseLabel(a.kind);
        if (this.focusPanelLabel) this.focusPanelLabel.textContent = `Focus · ${phaseLabel}`;
        const taskTitle = (() => {
            const t = this.todos.find((td) => Number(td.id) === Number(a.task_id));
            return t ? t.title : "(geen taak)";
        })();
        this.focusTask.innerHTML = `Bezig met <b>${this.escapeHtml(taskTitle)}</b>`;

        const startedMs = Date.parse(a.started_at);
        const elapsed = Math.max(0, Math.floor((Date.now() - startedMs) / 1000));
        let pct = 0;
        if (a.phase_seconds) {
            const remaining = Math.max(0, a.phase_seconds - elapsed);
            this.focusClock.textContent = this._formatClock(remaining);
            pct = Math.min(100, Math.round((elapsed / a.phase_seconds) * 100));
        } else {
            this.focusClock.textContent = this._formatClock(elapsed);
            pct = 0;
        }
        if (this.focusProgress) this.focusProgress.querySelector("i").style.width = `${pct}%`;

        const isPomodoro = a.kind !== "stopwatch";
        this.focusPauseBtn.hidden = !isPomodoro;
        this.focusStopBtn.hidden = false;

        if (isPomodoro && this.pomodoroSettings && a.kind === "pomodoro_focus") {
            const total = Number(this.pomodoroSettings.cycles_per_long_break || 4);
            const idx = Number(a.cycle_index || 1);
            this.focusCycleLabel.textContent = `Cyclus ${Math.min(idx, total)} / ${total}`;
            let pips = "";
            for (let i = 1; i <= total; i++) {
                pips += `<span class="pip${i <= idx ? " is-on" : ""}"></span>`;
            }
            this.focusCyclePips.innerHTML = pips;
            this.focusCycles.hidden = false;
        } else {
            this.focusCycles.hidden = true;
        }
    }

    // ── Search modal ───────────────────────────────────────────────────
    openSearchModal() {
        if (!this.searchModal) return;
        this.searchModal.hidden = false;
        this.searchModalInput.value = "";
        this._searchActiveIndex = 0;
        this._renderSearchResults();
        setTimeout(() => this.searchModalInput.focus(), 0);
    }

    closeSearchModal() {
        if (!this.searchModal) return;
        this.searchModal.hidden = true;
    }

    _onSearchKey(e) {
        if (e.key === "Escape") {
            e.preventDefault();
            this.closeSearchModal();
            return;
        }
        if (e.key === "ArrowDown") {
            e.preventDefault();
            this._setSearchActive(this._searchActiveIndex + 1);
            return;
        }
        if (e.key === "ArrowUp") {
            e.preventDefault();
            this._setSearchActive(this._searchActiveIndex - 1);
            return;
        }
        if (e.key === "Enter") {
            e.preventDefault();
            this._activateSearchHit(this._searchActiveIndex);
        }
    }

    _setSearchActive(idx) {
        if (!this._searchHits.length) return;
        const max = this._searchHits.length;
        const next = ((idx % max) + max) % max;
        this._searchActiveIndex = next;
        this.searchResults.querySelectorAll(".search-result-item").forEach((el) => {
            el.classList.toggle("is-active", Number(el.dataset.idx) === next);
        });
        const activeEl = this.searchResults.querySelector(`.search-result-item[data-idx="${next}"]`);
        if (activeEl && activeEl.scrollIntoView) {
            activeEl.scrollIntoView({ block: "nearest" });
        }
    }

    _renderSearchResults() {
        if (!this.searchResults) return;
        const q = (this.searchModalInput.value || "").trim().toLowerCase();
        const hits = [];
        const matches = (s) => s && s.toLowerCase().includes(q);

        if (q.length === 0) {
            // Default suggestions: show first few todos
            for (const t of this.todos.slice(0, 8)) {
                if (t.completed) continue;
                hits.push({ kind: "todo", id: t.id, label: t.title, meta: this._areaName(t.area_id) });
            }
        } else {
            for (const t of this.todos) {
                if (matches(t.title)) {
                    hits.push({ kind: "todo", id: t.id, label: t.title, meta: this._areaName(t.area_id), completed: !!t.completed });
                }
            }
            for (const p of this.projects) {
                if (matches(p.name)) hits.push({ kind: "project", id: p.id, label: p.name, meta: this._areaName(p.area_id) });
            }
            for (const a of this.areas) {
                if (matches(a.name)) hits.push({ kind: "area", id: a.id, label: a.name, color: a.color, meta: "Gebied" });
            }
            for (const g of this.goals) {
                if (matches(g.name)) hits.push({ kind: "goal", id: g.id, label: g.name, meta: this._areaName(g.area_id) });
            }
        }

        const limited = hits.slice(0, 30);
        this._searchHits = limited;
        this._searchActiveIndex = 0;

        if (this.searchModalEmpty) this.searchModalEmpty.hidden = limited.length > 0 || q.length === 0;

        if (limited.length === 0) {
            this.searchResults.innerHTML = "";
            return;
        }
        this.searchResults.innerHTML = limited.map((h, idx) => {
            let icon = "";
            if (h.kind === "todo") {
                icon = `<span class="sr-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/></svg></span>`;
            } else if (h.kind === "project") {
                icon = `<span class="sr-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></span>`;
            } else if (h.kind === "area") {
                icon = `<span class="sr-dot" style="background:${this.escapeHtml(h.color || "var(--ink-tertiary)")}"></span>`;
            } else if (h.kind === "goal") {
                icon = `<span class="sr-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/></svg></span>`;
            }
            const kindLabel = { todo: "Taak", project: "Project", area: "Gebied", goal: "Doel" }[h.kind] || "";
            const meta = h.meta || kindLabel;
            return `
                <li class="search-result-item${idx === 0 ? " is-active" : ""}" role="option" data-idx="${idx}">
                    ${icon}
                    <span class="sr-title">${this.escapeHtml(h.label || "(naamloos)")}</span>
                    <span class="sr-meta">${this.escapeHtml(meta)}</span>
                </li>
            `;
        }).join("");
    }

    _activateSearchHit(idx) {
        const hit = this._searchHits[idx];
        if (!hit) return;
        this.closeSearchModal();
        if (hit.kind === "todo") {
            this.openModal(hit.id);
        } else if (hit.kind === "project") {
            this.setView({ type: "project", value: hit.id });
        } else if (hit.kind === "area") {
            this.setView({ type: "area", value: hit.id });
        } else if (hit.kind === "goal") {
            this.setView({ type: "goal", value: hit.id });
        }
    }

    _areaName(areaId) {
        if (!areaId) return "";
        const a = this.areas.find((x) => x.id === areaId);
        return a ? a.name : "";
    }

    // ── Today view ─────────────────────────────────────────────────────
    _isTodoForToday(t) {
        if (t.project_id) return false;
        if (t.planned_date !== this.getToday()) return false;
        if (t.completed) return this._completedTodayIds.has(t.id);
        return true;
    }

    _loadCompletedTodayIds() {
        try {
            const raw = localStorage.getItem("gripCompletedToday");
            if (!raw) return new Set();
            const data = JSON.parse(raw);
            if (!data || data.date !== this.getToday()) return new Set();
            return new Set((data.ids || []).map(Number));
        } catch (_) {
            return new Set();
        }
    }

    _saveCompletedTodayIds() {
        try {
            localStorage.setItem("gripCompletedToday", JSON.stringify({
                date: this.getToday(),
                ids: Array.from(this._completedTodayIds),
            }));
        } catch (_) {
            // ignore quota / serialization errors
        }
    }

    renderTodayView() {
        if (!this.todayView) return;
        const todays = this.todos.filter((t) => this._isTodoForToday(t));

        const panelCount = document.getElementById("vandaagPanelCount");
        if (panelCount) {
            const open = todays.filter((t) => !t.completed).length;
            panelCount.textContent = open > 0 ? String(open) : "";
        }

        this._applyTodayMode();

        if (this._todayMode === "list") {
            this._renderTodayGoals();
            if (typeof this._renderTodayTasksList === "function") {
                this._renderTodayTasksList(todays);
            }
            if (typeof this._renderStreaks === "function") this._renderStreaks();
        } else {
            this.renderTodaySchema();
        }
    }

    _applyTodayMode() {
        const mode = this._todayMode === "list" ? "list" : "agenda";
        document.querySelectorAll(".td-mode").forEach((el) => {
            if (el.classList.contains(`td-mode-${mode}`)) el.hidden = false;
            else el.hidden = true;
        });
        document.querySelectorAll("[data-td-mode]").forEach((btn) => {
            btn.classList.toggle("on", btn.dataset.tdMode === mode);
        });
        const stepper = document.getElementById("tbDayStepperWrap");
        if (stepper) stepper.hidden = mode !== "agenda";
    }

    setTodayMode(mode) {
        this._todayMode = mode === "list" ? "list" : "agenda";
        localStorage.setItem("gripTodayMode", this._todayMode);
        this.renderTodayView();
        if (typeof this.refreshTodayAgenda === "function") this.refreshTodayAgenda();
    }

    _renderTodayHeadline(openCount, todays) {
        if (!this.todayHeadline) return;
        const projectsOnToday = this.projects.filter((p) =>
            this.todayProjectIds.has(p.id) && (!p.status || p.status === "active")
        ).length;
        const minutes = todays.reduce((sum, t) => sum + (Number(t.duration) || Number(t.duration_minutes) || 0), 0);
        const hours = Math.floor(minutes / 60);
        const mins = minutes % 60;
        const focusLabel = hours > 0 ? `${hours}u ${mins}m` : `${mins}m`;
        const username = (document.querySelector(".profile-name")?.textContent || "").trim();
        const greet = this._greeting();

        this.todayHeadline.innerHTML = `<em>${openCount}</em>${openCount === 1 ? "ding" : "dingen"}<br>op je <i>radar.</i>`;
        if (this.todaySub) {
            const greetText = username ? `${greet} ${this.escapeHtml(username)}.` : `${greet}.`;
            this.todaySub.innerHTML = `${greetText} <b>${projectsOnToday} ${projectsOnToday === 1 ? "project" : "projecten"}</b> ${projectsOnToday === 1 ? "staat" : "staan"} op Vandaag en je hebt <b>${focusLabel}</b> aan focus-werk gepland. Begin klein.`;
        }
    }

    _greeting() {
        const h = new Date().getHours();
        if (h < 6) return "Goedenacht";
        if (h < 12) return "Goedemorgen";
        if (h < 18) return "Goedemiddag";
        return "Goedenavond";
    }

    _countActiveGoals() {
        const today = this.getToday();
        return this.goals.filter((g) => {
            if (g.archived) return false;
            if (g.end_date && g.end_date < today) return false;
            return true;
        }).length;
    }

    _renderTodayGoals() {
        if (!this.todayGoals) return;
        const flagged = this.projects.filter((p) =>
            this.todayProjectIds.has(p.id) && (!p.status || p.status === "active")
        );

        if (flagged.length === 0) {
            this.todayGoals.innerHTML = `
                <div class="goal-card today-empty-card" style="grid-column: 1 / -1; justify-content:center; color: var(--ink-tertiary); cursor: default;">
                    Geen projecten op Vandaag. Open een project en kies "Toon op Vandaag".
                </div>
            `;
            return;
        }

        // Sort by urgency: closest end_date first.
        flagged.sort((a, b) => {
            const ax = a.end_date || "9999-12-31";
            const bx = b.end_date || "9999-12-31";
            return ax.localeCompare(bx);
        });
        const top = flagged.slice(0, 3);

        this.todayGoals.innerHTML = top.map((p, idx) => {
            const pct = this._projectProgress(p);
            const area = this.areas.find((a) => a.id === p.area_id);
            const areaName = area ? area.name.toUpperCase() : "PROJECT";
            const due = this._formatGoalDue(p.end_date);
            const featuredCls = idx === 0 ? " is-featured" : "";
            return `
                <div class="goal-card${featuredCls}" data-project-id="${p.id}" role="button" tabindex="0">
                    <div class="ring" style="--p: ${pct};"><span>${pct}%</span></div>
                    <div class="goal-meta">
                        <span class="area">${this.escapeHtml(areaName)}</span>
                        <span class="name">${this.escapeHtml(p.name || "(naamloos)")}</span>
                        <span class="due">${due}</span>
                    </div>
                </div>
            `;
        }).join("");

        this.todayGoals.querySelectorAll(".goal-card[data-project-id]").forEach((card) => {
            card.addEventListener("click", () => {
                this.setView({ type: "project", value: Number(card.dataset.projectId) });
            });
        });
    }

    _projectProgress(project) {
        const tasks = this.todos.filter((t) => t.project_id === project.id);
        if (tasks.length === 0) return 0;
        const done = tasks.filter((t) => t.completed).length;
        return Math.round((done / tasks.length) * 100);
    }

    get todayProjectIds() {
        // Derived live from this.projects so it stays in sync after server updates.
        const ids = new Set();
        for (const p of this.projects) {
            if (p.show_on_today) ids.add(p.id);
        }
        return ids;
    }

    async toggleProjectOnToday() {
        if (this.currentView.type !== "project") return;
        const id = Number(this.currentView.value);
        const project = this.projects.find((p) => p.id === id);
        if (!project) return;
        const next = !project.show_on_today;
        // Optimistic update
        project.show_on_today = next;
        this._renderProjectMenuFavState(id);
        try {
            const data = await this.request(`/api/projects/${id}`, {
                method: "PATCH",
                body: JSON.stringify({ show_on_today: next }),
            });
            if (data && data.project) {
                Object.assign(project, data.project);
            }
        } catch (error) {
            // Revert on failure
            project.show_on_today = !next;
            this._renderProjectMenuFavState(id);
            this.setStatus(error.message);
        }
    }

    async _migrateLegacyTodayProjects() {
        // One-time migration: if localStorage has pinned project ids and the
        // server hasn't received them yet (no project has show_on_today=true),
        // push the local ids up so the user keeps their selection on first sync.
        if (!this._legacyTodayProjectIds || this._legacyTodayProjectIds.size === 0) {
            return;
        }
        const serverHasAny = this.projects.some((p) => p.show_on_today);
        if (serverHasAny) {
            this._legacyTodayProjectIds.clear();
            localStorage.removeItem("gripTodayProjects");
            return;
        }
        const idsToMigrate = Array.from(this._legacyTodayProjectIds).filter((id) =>
            this.projects.some((p) => p.id === id)
        );
        for (const id of idsToMigrate) {
            try {
                const data = await this.request(`/api/projects/${id}`, {
                    method: "PATCH",
                    body: JSON.stringify({ show_on_today: true }),
                });
                if (data && data.project) {
                    const proj = this.projects.find((p) => p.id === id);
                    if (proj) Object.assign(proj, data.project);
                }
            } catch (_) {
                // Best-effort migration; ignore failures so the app keeps working.
            }
        }
        this._legacyTodayProjectIds.clear();
        localStorage.removeItem("gripTodayProjects");
    }

    _renderProjectMenuFavState(projectId) {
        if (!this.projectMenu) return;
        const isOn = this.todayProjectIds.has(Number(projectId));
        const item = this.projectMenu.querySelector(
            '[data-project-action="toggle-today"]'
        );
        if (item) item.classList.toggle("is-active", isOn);
        if (this.projectMenuFavLabel) {
            this.projectMenuFavLabel.textContent = isOn
                ? "Op Vandaag"
                : "Zet in favorieten";
        }
    }

    _closeProjectMenu() {
        if (!this.projectMenuWrap) return;
        this.projectMenuWrap.classList.remove("menu-open");
        if (this.projectMenuBtn) {
            this.projectMenuBtn.setAttribute("aria-expanded", "false");
        }
        document.body.classList.remove("menu-backdrop-active");
    }

    _toggleProjectMenu() {
        if (!this.projectMenuWrap || !this.projectMenuBtn) return;
        const willOpen = !this.projectMenuWrap.classList.contains("menu-open");
        this.closeAllMenus();
        this.projectMenuWrap.classList.toggle("menu-open", willOpen);
        this.projectMenuBtn.setAttribute("aria-expanded", String(willOpen));
        if (willOpen) {
            document.body.classList.add("menu-backdrop-active");
        }
    }

    async _renameCurrentProject() {
        if (this.currentView.type !== "project") return;
        const id = Number(this.currentView.value);
        const project = this.projects.find((p) => p.id === id);
        if (!project) return;
        const next = window.prompt("Nieuwe naam voor het project:", project.name || "");
        if (next === null) return;
        const trimmed = next.trim();
        if (!trimmed || trimmed === project.name) return;
        try {
            const data = await this.request(`/api/projects/${id}`, {
                method: "PATCH",
                body: JSON.stringify({ name: trimmed }),
            });
            if (data && data.project) {
                Object.assign(project, data.project);
            } else {
                project.name = trimmed;
            }
            this.renderProjectsSidebar();
            this.renderAreaTree();
            this._populateProjectSelects();
            this.renderProjectView();
            this.activeListLabel.textContent = this.getViewLabel();
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    async _deleteCurrentProject() {
        if (this.currentView.type !== "project") return;
        const id = Number(this.currentView.value);
        const project = this.projects.find((p) => p.id === id);
        if (!project) return;
        const confirmed = window.confirm(
            `Weet je zeker dat je '${project.name}' wilt verwijderen?`
        );
        if (!confirmed) return;
        try {
            await this.request(`/api/projects/${id}`, { method: "DELETE" });
            this.projects = this.projects.filter((p) => p.id !== id);
            this.completedProjects = this.completedProjects.filter((p) => p.id !== id);
            this.renderProjectsSidebar();
            this.renderAreaTree();
            this._populateProjectSelects();
            this.setView({ type: "list", value: "inbox" });
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    // ── Project view (kanban) ─────────────────────────────────────────
    renderProjectView() {
        if (!this.projectView || !this.projHead || !this.projCols) return;
        const projectId = Number(this.currentView.value);
        const project =
            this.projects.find((p) => p.id === projectId) ||
            this.completedProjects.find((p) => p.id === projectId);
        if (!project) {
            this.projHead.innerHTML = `<div class="proj-body"><div class="proj-title">Project niet gevonden</div></div>`;
            this.projCols.innerHTML = "";
            return;
        }

        const tasks = this.todos.filter((t) => t.project_id === projectId);
        const completed = tasks.filter((t) => t.completed);
        const open = tasks.filter((t) => !t.completed);
        const progress = this._projectProgress(project);

        this.projHead.innerHTML = this._renderProjectHead(project, completed.length, open.length, progress);
        this.projCols.innerHTML = this._renderKanbanColumns(open, completed);
    }

    _renderProjectHead(project, doneCount, openCount, progress) {
        const areaName = project.area_id ? this._areaName(project.area_id) : "";
        const goal = project.goal_id ? this.goals.find((g) => g.id === project.goal_id) : null;
        const ctxParts = [];
        if (areaName) ctxParts.push(`Gebied · ${this.escapeHtml(areaName).toUpperCase()}`);
        if (goal) ctxParts.push(`Doel · ${this.escapeHtml(goal.name).toUpperCase()}`);
        const contextLine = ctxParts.length
            ? `<div class="proj-context">${ctxParts.join(" › ")}</div>`
            : "";

        const stats = [];
        stats.push(`<div class="stat"><b>${doneCount}</b>taken voltooid</div>`);
        stats.push(`<div class="stat"><b>${openCount}</b>nog te doen</div>`);
        if (project.end_date) {
            stats.push(`<div class="stat"><b>${this.escapeHtml(this._formatGoalDue(project.end_date) || project.end_date)}</b>deadline</div>`);
            const days = this._daysUntil(project.end_date);
            if (days !== null && days >= 0) {
                stats.push(`<div class="stat"><b>${days}</b>dagen over</div>`);
            }
        }

        return `
            <div class="proj-ring" style="--p:${progress};"><span>${progress}%</span></div>
            <div class="proj-body">
                <h1 class="proj-title">${this.escapeHtml(project.name || "(naamloos)")}</h1>
                ${contextLine}
                <div class="proj-row">${stats.join("")}</div>
                <div class="proj-bar"><i style="width:${progress}%;"></i></div>
            </div>
        `;
    }

    _daysUntil(dateStr) {
        if (!dateStr) return null;
        const target = new Date(dateStr);
        if (Number.isNaN(target.getTime())) return null;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        target.setHours(0, 0, 0, 0);
        return Math.round((target - today) / 86400000);
    }

    _renderKanbanColumns(openTasks, completedTasks) {
        const inbox = openTasks.filter((t) => !t.state || t.state === "to_do" || t.state === "someday");
        const bezig = openTasks.filter((t) => t.state === "in_progress");
        const wachten = openTasks.filter((t) => t.state === "waiting");
        const cols = [
            { label: "Te doen", tasks: inbox, modifier: "", state: "to_do" },
            { label: "Bezig", tasks: bezig, modifier: "", state: "in_progress" },
            { label: "Wachten", tasks: wachten, modifier: "", state: "waiting" },
            { label: "Voltooid", tasks: completedTasks, modifier: "is-done", state: "done" },
        ];
        return cols.map((c) => this._renderKanbanColumn(c)).join("");
    }

    _renderKanbanColumn({ label, tasks, modifier, state }) {
        const cards = tasks.length
            ? tasks.map((t) => this._renderKanbanCard(t)).join("")
            : `<div class="kanban-empty">Niets hier.</div>`;
        return `
            <div class="kanban-col ${modifier}" data-kanban-state="${state}">
                <div class="kanban-head">${this.escapeHtml(label)} <span class="num">${tasks.length}</span></div>
                <div class="kanban-cards" data-kanban-dropzone="${state}">${cards}</div>
            </div>
        `;
    }

    _renderKanbanCard(todo) {
        const areaColor = todo.area_id ? this.getAreaColor(todo.area_id) : null;
        const dotMarkup = areaColor
            ? `<span class="dot" style="background:${this.escapeHtml(areaColor)}"></span>`
            : "";
        const meta = this._renderKanbanMeta(todo);
        return `
            <div class="kcard" role="button" tabindex="0" draggable="true" data-kanban-todo-id="${todo.id}">
                <div class="kt">${this.escapeHtml(todo.title)}</div>
                <div class="kmeta">${dotMarkup}${meta}</div>
            </div>
        `;
    }

    _renderKanbanMeta(todo) {
        const parts = [];
        if (todo.completed) {
            const date = todo.planned_date || todo.deadline || todo.start_date;
            if (date) parts.push(this.escapeHtml(this._formatGoalDue(date) || date));
        } else {
            const date = todo.planned_date || todo.start_date || todo.deadline;
            if (date) {
                const today = this.getToday();
                const formatted = this._formatGoalDue(date) || date;
                if (date === today) {
                    parts.push(`<span class="accent">Vandaag</span>`);
                } else {
                    parts.push(this.escapeHtml(formatted));
                }
            } else {
                parts.push("geen datum");
            }
            if (todo.duration) parts.push(`${Number(todo.duration)} min`);
        }
        return parts.join(`<span class="sep">·</span>`);
    }

    _clearKanbanDragHover() {
        if (!this.projectView) return;
        this.projectView
            .querySelectorAll(".is-drop-target")
            .forEach((el) => el.classList.remove("is-drop-target"));
        this._kanbanHoverEl = null;
    }

    async _moveKanbanTodo(id, targetState) {
        const todo = this.todos.find((t) => t.id === id);
        if (!todo) return;
        const currentState = todo.completed ? "done" : todo.state || "to_do";
        const normalizedTarget = targetState === "done" ? "done" : targetState;
        if (currentState === normalizedTarget) return;

        const previous = { state: todo.state, completed: todo.completed };
        if (normalizedTarget === "done") {
            todo.completed = true;
            todo.state = "done";
        } else {
            todo.completed = false;
            todo.state = normalizedTarget;
        }
        this.renderProjectView();
        this.updateSidebarCounts();
        try {
            const data = await this.request(`/api/todos/${id}`, {
                method: "PATCH",
                body: JSON.stringify({ state: normalizedTarget }),
            });
            if (data && data.todo) {
                Object.assign(todo, data.todo);
                if (data.spawned_todo) this.todos.unshift(data.spawned_todo);
                this.renderProjectView();
            }
        } catch (error) {
            Object.assign(todo, previous);
            this.renderProjectView();
            this.setStatus(error.message);
        }
    }

    _handleKanbanBack() {
        if (this.currentView.type !== "project") return;
        const projectId = Number(this.currentView.value);
        const project =
            this.projects.find((p) => p.id === projectId) ||
            this.completedProjects.find((p) => p.id === projectId);
        if (project && project.goal_id) {
            this.setView({ type: "goal", value: project.goal_id });
        } else if (project && project.area_id) {
            this.setView({ type: "area", value: project.area_id });
        } else {
            this.setView({ type: "list", value: "today" });
        }
    }

    _goalProgress(goal) {
        // Percentage based on completed vs total tasks across all projects within the goal.
        const projectIds = new Set(this.projects.filter((p) => p.goal_id === goal.id).map((p) => p.id));
        if (projectIds.size === 0) return 0;
        const tasks = this.todos.filter((t) => t.project_id && projectIds.has(t.project_id));
        if (tasks.length === 0) return 0;
        const done = tasks.filter((t) => t.completed).length;
        return Math.round((done / tasks.length) * 100);
    }

    _formatGoalDue(endDate) {
        if (!endDate) return "geen einddatum";
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const target = new Date(endDate + "T00:00:00");
        const days = Math.round((target - today) / 86400000);
        if (days < 0) return `<b>verlopen</b>`;
        if (days === 0) return `<b>vandaag</b>`;
        if (days === 1) return `nog <b>1 dag</b>`;
        if (days <= 60) return `nog <b>${days} dagen</b>`;
        const months = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"];
        const m = months[target.getMonth()];
        return `eind <b>${m}</b>`;
    }

    _renderTodayTasksList(todays) {
        if (!this.todayTasks) return;
        if (todays.length === 0) {
            this.todayTasks.innerHTML = `<div class="today-empty">Niets gepland voor vandaag. Tijd om iets toe te voegen.</div>`;
            return;
        }
        // Group by Hele dag / Ochtend / Middag / Avond based on planned time.
        // Tasks without a planned time go into "Hele dag".
        const groups = { hele: [], ochtend: [], middag: [], avond: [] };
        for (const t of todays) {
            groups[this._taskTimeSlot(t)].push(t);
        }
        // Sort timed groups chronologically.
        const byTime = (a, b) => {
            const ta = this._formatTimeValue(a.planned_time) || "99:99";
            const tb = this._formatTimeValue(b.planned_time) || "99:99";
            return ta.localeCompare(tb);
        };
        ["ochtend", "middag", "avond"].forEach((k) => groups[k].sort(byTime));
        const slotLabels = { hele: "Hele dag", ochtend: "Ochtend", middag: "Middag", avond: "Avond" };
        const order = ["hele", "ochtend", "middag", "avond"];
        let html = "";
        for (const k of order) {
            const items = groups[k];
            if (items.length === 0) continue;
            html += `<div class="task-group-head">${slotLabels[k]} <span class="line"></span><span class="gcount">${items.length}</span></div>`;
            html += items.map((t) => this._renderTodayTask(t)).join("");
        }
        this.todayTasks.innerHTML = html;
    }

    _taskTimeSlot(todo) {
        // Tasks don't yet carry a planned time — bucket everything under "Hele dag".
        // Once a time field is added, return "ochtend" / "middag" / "avond" based on the hour.
        const hour = this._taskPlannedHour(todo);
        if (hour == null) return "hele";
        if (hour < 12) return "ochtend";
        if (hour < 18) return "middag";
        return "avond";
    }

    _taskPlannedHour(todo) {
        const t = todo.planned_time || todo.planned_at;
        if (!t) return null;
        const m = String(t).match(/(\d{1,2}):(\d{2})/);
        if (!m) return null;
        return Number(m[1]);
    }

    _formatTimeValue(t) {
        // Postgres `time` columns serialize as "HH:MM:SS"; <input type="time">
        // wants "HH:MM".
        if (!t) return "";
        const m = String(t).match(/^(\d{2}:\d{2})/);
        return m ? m[1] : "";
    }

    _renderTodayTask(todo) {
        const area = this.areas.find((a) => a.id === this.resolveTaskAreaId(todo));
        const project = this.projects.find((p) => p.id === todo.project_id);
        const areaTag = area
            ? `<span class="today-task-tag"><span class="dot" style="background:${this.escapeHtml(area.color || "var(--ink-tertiary)")}"></span>${this.escapeHtml(area.name)}${project ? " · " + this.escapeHtml(project.name) : ""}</span>`
            : (project ? `<span class="today-task-tag"><span class="dot" style="background:var(--ink-tertiary)"></span>${this.escapeHtml(project.name)}</span>` : "");
        const dur = Number(todo.duration) || Number(todo.duration_minutes) || 0;
        const startTime = this._formatTimeValue(todo.planned_time);
        const timeChipBody = startTime
            ? `${startTime}${dur > 0 ? ` · ${dur} min` : ""}`
            : (dur > 0 ? `${dur} min` : "");
        const timeChip = timeChipBody
            ? `<span class="today-task-time"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${this.escapeHtml(timeChipBody)}</span>`
            : "";
        const priorityCls = todo.priority && todo.priority !== "not_set" ? ` priority-${todo.priority}` : "";
        const checkedCls = todo.completed ? " is-checked" : "";
        const doneCls = todo.completed ? " is-done" : "";
        return `
            <div class="today-task${doneCls}" data-id="${todo.id}">
                <button type="button" class="today-task-check${priorityCls}${checkedCls}" data-action="toggle-complete" aria-label="Markeer als ${todo.completed ? "open" : "afgerond"}">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                </button>
                <div class="today-task-body" data-action="open">
                    <div class="today-task-title">${this.escapeHtml(todo.title || "")}</div>
                    <div class="today-task-meta">${areaTag}</div>
                </div>
                ${timeChip}
                <span></span>
            </div>
        `;
    }

    _onTodayTaskClick(e) {
        const taskEl = e.target.closest(".today-task");
        if (!taskEl) return;
        const id = Number(taskEl.dataset.id);
        if (!id) return;
        const action = e.target.closest("[data-action]")?.dataset.action;
        if (action === "toggle-complete") {
            this.toggleTodo(id);
            return;
        }
        this.openModal(id);
    }

    // ===========================================================
    // Tijdblokken (daily planner)
    // ===========================================================
    _tbDefaultBlocks() {
        // Seed a believable day. Times are "HH:MM" 24h strings.
        return [
            { id: 1,  start: "06:30", end: "07:00", title: "Ochtendroutine",       type: "routine", area: 1, chip: "Routine", pomos: 0 },
            { id: 2,  start: "07:00", end: "07:45", title: "Hardlopen",            type: "routine", area: 1, chip: "Routine", pomos: 0 },
            { id: 3,  start: "08:00", end: "08:30", title: "Ontbijt met Lieke",    type: "routine", area: 3, chip: "Familie", pomos: 0 },
            { id: 4,  start: "09:00", end: "11:00", title: "Diep werk · onboarding-flow", type: "focus",   area: 2, chip: "Diep werk", pomos: 4, pomosDone: 2, protect: true },
            { id: 5,  start: "11:00", end: "11:15", title: "Koffie",               type: "routine", area: 5, chip: "Pauze",   pomos: 0 },
            { id: 6,  start: "11:30", end: "12:00", title: "1:1 met Pieter",       type: "meeting", area: 2, chip: "Vergader", pomos: 0 },
            { id: 7,  start: "12:00", end: "12:45", title: "Lunch",                type: "routine", area: 1, chip: "Routine", pomos: 0 },
            { id: 8,  start: "13:00", end: "14:00", title: "Klantgesprek · Acme",  type: "meeting", area: 2, chip: "Vergader", pomos: 0 },
            { id: 9,  start: "14:00", end: "15:30", title: "Diep werk · spec schrijven", type: "focus", area: 2, chip: "Diep werk", pomos: 3, pomosDone: 0, protect: true },
            { id: 10, start: "15:45", end: "16:15", title: "Standup product",      type: "meeting", area: 2, chip: "Vergader", pomos: 0 },
            { id: 11, start: "16:30", end: "17:15", title: "Spaans · les 14",      type: "focus",   area: 4, chip: "Leren",    pomos: 1, pomosDone: 0 },
            { id: 12, start: "17:30", end: "18:30", title: "Krachttraining",       type: "routine", area: 1, chip: "Routine", pomos: 0 },
            { id: 13, start: "19:00", end: "20:00", title: "Eten met familie",     type: "routine", area: 3, chip: "Familie", pomos: 0 },
            { id: 14, start: "20:30", end: "21:30", title: "Lezen",                type: "routine", area: 5, chip: "Bescherm", pomos: 0, protect: true },
        ];
    }

    _tbDefaultPool() {
        return [
            { id: "p1", title: "PR review · admin panel",        meta: "Werk · vandaag",  area: 2, est: 45 },
            { id: "p2", title: "Belasting-aangifte voorbereiden",meta: "Persoonlijk",     area: 5, est: 60 },
            { id: "p3", title: "Mail aan accountant",            meta: "Werk",            area: 2, est: 15 },
            { id: "p4", title: "Boodschappen plannen",           meta: "Familie",         area: 3, est: 20 },
            { id: "p5", title: "Spaans vocabulaire herhalen",    meta: "Leren · vandaag", area: 4, est: 30 },
            { id: "p6", title: "Boek hoofdstuk 5",               meta: "Persoonlijk",     area: 5, est: 50 },
        ];
    }

    _tbTemplates() {
        return [
            { id: "tplD", letter: "D", name: "Diep werk",   desc: "25 min focus + 5 min pauze", dur: 30,  type: "focus", dark: true,  area: 2 },
            { id: "tplP", letter: "P", name: "Pauze",       desc: "Korte ademruimte",           dur: 15,  type: "rust",  dark: false, area: 5 },
            { id: "tplB", letter: "B", name: "Boek lezen",  desc: "Bescherm tegen vergader",    dur: 45,  type: "rust",  dark: false, area: 5 },
        ];
    }

    _tbAreas() {
        // Use the real user-defined areas; fall back to defaults if none.
        if (this.areas && this.areas.length) {
            return this.areas
                .filter((a) => !a.archived)
                .map((a, idx) => ({
                    id: a.id,
                    name: a.name,
                    color: a.color || `var(--area-${(idx % 5) + 1})`,
                }));
        }
        return [
            { id: 1, name: "Gezondheid",  color: "var(--area-1)" },
            { id: 2, name: "Werk",        color: "var(--area-2)" },
            { id: 3, name: "Familie",     color: "var(--area-3)" },
            { id: 4, name: "Leren",       color: "var(--area-4)" },
            { id: 5, name: "Persoonlijk", color: "var(--area-5)" },
        ];
    }

    _tbAreaColor(id) {
        const a = this._tbAreas().find((x) => x.id === id);
        return a ? a.color : "var(--ink-tertiary)";
    }

    _tbAreaName(id) {
        const a = this._tbAreas().find((x) => x.id === id);
        return a ? a.name : "Gebied";
    }

    _tbParseTime(s) {
        const [h, m] = s.split(":").map((n) => Number(n));
        return h * 60 + m;
    }

    _tbFormatMins(mins) {
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        if (h === 0) return `${m}m`;
        return `${h}u ${String(m).padStart(2, "0")}m`;
    }

    _tbFormatTime(mins) {
        mins = Math.max(0, Math.min(24 * 60 - 1, Math.round(mins)));
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }

    _tbWeekNumber(d) {
        const target = new Date(d.valueOf());
        const dayNr = (d.getDay() + 6) % 7;
        target.setDate(target.getDate() - dayNr + 3);
        const firstThursday = target.valueOf();
        target.setMonth(0, 1);
        if (target.getDay() !== 4) {
            target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
        }
        return 1 + Math.ceil((firstThursday - target) / 604800000);
    }

    _tbSeason(d) {
        const m = d.getMonth() + 1;
        if (m >= 3 && m <= 5) return "Lente";
        if (m >= 6 && m <= 8) return "Zomer";
        if (m >= 9 && m <= 11) return "Herfst";
        return "Winter";
    }

    _tbDateLabels(d) {
        const days = ["zondag","maandag","dinsdag","woensdag","donderdag","vrijdag","zaterdag"];
        const months = ["januari","februari","maart","april","mei","juni","juli","augustus","september","oktober","november","december"];
        const date = `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]}`;
        const week = `Week ${this._tbWeekNumber(d)} · ${this._tbSeason(d)}`;
        return { date, week };
    }

    _tbBuildBlocksFromData() {
        // Combine calendar events (meeting) + planned tasks (focus/routine) + user extras.
        const today = this._tbActiveDateKey();
        const events = this.calendarEventsByRange?.get(`${today}|${today}`) || [];
        const blocks = [];

        for (const ev of events) {
            if (ev.all_day) continue;
            const start = new Date(ev.start_at);
            const end = new Date(ev.end_at);
            if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
            const sMin = start.getHours() * 60 + start.getMinutes();
            const eMin = end.getHours() * 60 + end.getMinutes();
            if (eMin <= sMin) continue;
            const subscriptionAreaId = ev.subscription_area_id || null;
            // Shortcode in the event description maps to a balance category
            // (mirrors the categories used by the next-week time-budget block):
            //   DEEP → Diep werk (focus)
            //   FAM  → Familie & vrienden
            //   MEET → Meeting (also the default for untagged events)
            const desc = (ev.description || "").toString();
            let evType = "meeting";
            let evChipDefault = "Meeting";
            if (/\bDEEP\b/i.test(desc)) {
                evType = "focus";
                evChipDefault = "Diep werk";
            } else if (/\bFAM\b/i.test(desc)) {
                evType = "family";
                evChipDefault = "Familie & vrienden";
            } else if (/\bMEET\b/i.test(desc)) {
                evType = "meeting";
                evChipDefault = "Meeting";
            }
            blocks.push({
                id: `cal-${ev.id || ev.uid || `${ev.start_at}-${ev.summary || ""}`}`,
                kind: "calendar",
                start: this._tbFormatTime(sMin),
                end: this._tbFormatTime(eMin),
                title: ev.summary || "(geen titel)",
                type: evType,
                area: subscriptionAreaId || this._tbFallbackAreaId(),
                chip: ev.subscription_name || evChipDefault,
                pomos: 0,
                calendarColor: ev.subscription_color || null,
            });
        }

        const todays = (this.todos || []).filter((t) => this._tbIsTodoForActiveDate(t) && !t.completed);
        for (const t of todays) {
            const startTime = this._tbExtractTaskStart(t);
            if (!startTime) continue;
            const dur = Number(t.duration) || Number(t.duration_minutes) || 30;
            const sMin = startTime;
            const eMin = sMin + dur;
            const areaId = this.resolveTaskAreaId ? this.resolveTaskAreaId(t) : t.area_id;
            blocks.push({
                id: `task-${t.id}`,
                kind: "task",
                taskId: t.id,
                start: this._tbFormatTime(sMin),
                end: this._tbFormatTime(eMin),
                title: t.title || "(taak)",
                type: dur >= 45 ? "focus" : "routine",
                area: areaId || this._tbFallbackAreaId(),
                chip: dur >= 45 ? "Diep werk" : "Taak",
                pomos: dur >= 45 ? Math.max(1, Math.round(dur / 30)) : 0,
                pomosDone: 0,
            });
        }

        for (const extra of this._tbExtraBlocks) {
            blocks.push({ ...extra });
        }

        // Apply user overrides; drop blocks marked hidden
        const filtered = [];
        for (const b of blocks) {
            const ov = this._tbBlocksOverrides.get(String(b.id));
            if (ov) {
                if (ov._hidden) continue;
                Object.assign(b, ov);
            }
            filtered.push(b);
        }

        this._tbBlocks = filtered.sort((a, b) => this._tbParseTime(a.start) - this._tbParseTime(b.start));
    }

    _tbExtractTaskStart(task) {
        // Tasks may store planned start as ISO datetime or "HH:MM" string.
        const today = this._tbActiveDateKey();
        const date = task.planned_date || task.planned_at?.slice(0, 10);
        if (date !== today) return null;
        const t = task.planned_time || (task.planned_at && task.planned_at.length > 10 ? task.planned_at.slice(11, 16) : null);
        if (!t) return null;
        const [h, m] = t.split(":").map(Number);
        if (Number.isNaN(h)) return null;
        return h * 60 + (m || 0);
    }

    _tbIsTodoForActiveDate(t) {
        if (t.project_id) return false;
        const date = t.planned_date || (t.planned_at ? t.planned_at.slice(0, 10) : null);
        return date === this._tbActiveDateKey();
    }

    _tbFallbackAreaId() {
        const a = (this.areas || []).find((x) => !x.archived);
        return a ? a.id : 1;
    }

    _tbBuildPoolFromTasks() {
        const today = this._tbActiveDateKey();
        const todays = (this.todos || []).filter((t) => this._tbIsTodoForActiveDate(t) && !t.completed);
        // Keep every task with no explicit start-time in the pool; tasks that
        // were dragged onto the schema stay listed but are flagged as planned.
        const unscheduled = todays.filter((t) => !this._tbExtractTaskStart(t));
        this._tbPool = unscheduled.map((t) => {
            const areaId = this.resolveTaskAreaId ? this.resolveTaskAreaId(t) : t.area_id;
            return {
                id: `task-${t.id}`,
                taskId: t.id,
                title: t.title || "(taak)",
                meta: this._tbPoolMeta(t),
                area: areaId || this._tbFallbackAreaId(),
                est: Number(t.duration) || Number(t.duration_minutes) || 30,
                planned: this._tbScheduledTaskIds.has(t.id),
            };
        });
        // Suppress unused-var lint: ensure today referenced
        void today;
    }

    _tbPoolMeta(task) {
        const parts = [];
        if (task.list === "today") parts.push("Vandaag");
        else if (task.list === "inbox") parts.push("Inbox");
        const areaId = this.resolveTaskAreaId ? this.resolveTaskAreaId(task) : task.area_id;
        const area = (this.areas || []).find((a) => a.id === areaId);
        if (area && area.name) parts.unshift(area.name);
        return parts.join(" · ");
    }

    _tbEnsureData() {
        this._tbBuildBlocksFromData();
        this._tbBuildPoolFromTasks();
    }

    _tbStats() {
        // Build interval lists per type so overlapping events are not double counted.
        const byType = { focus: [], meeting: [], rust: [], family: [] };
        const allIntervals = [];
        for (const b of this._tbBlocks) {
            const s = this._tbParseTime(b.start);
            const e = this._tbParseTime(b.end);
            if (e <= s) continue;
            const list = byType[b.type] || (byType[b.type] = []);
            list.push([s, e]);
            allIntervals.push([s, e]);
        }
        const unionMinutes = (intervals) => {
            if (!intervals.length) return 0;
            const sorted = intervals.slice().sort((a, b) => a[0] - b[0]);
            let total = 0;
            let [curS, curE] = sorted[0];
            for (let i = 1; i < sorted.length; i++) {
                const [s, e] = sorted[i];
                if (s <= curE) curE = Math.max(curE, e);
                else { total += curE - curS; curS = s; curE = e; }
            }
            total += curE - curS;
            return total;
        };
        const totals = {
            focus:   unionMinutes(byType.focus),
            meeting: unionMinutes(byType.meeting),
            rust:    unionMinutes(byType.rust),
            family:  unionMinutes(byType.family),
            total:   unionMinutes(allIntervals),
        };

        // Per-area is informational; sum durations weighted by share of overlap.
        const perArea = {};
        for (const b of this._tbBlocks) {
            const dur = this._tbParseTime(b.end) - this._tbParseTime(b.start);
            if (dur <= 0) continue;
            perArea[b.area] = (perArea[b.area] || 0) + dur;
        }

        const cap = 10 * 60;
        const free = Math.max(0, cap - totals.total);
        return { totals, free, cap, perArea };
    }

    renderTodaySchema() {
        this._tbEnsureData();
        this._tbRenderDayStep();
        this._tbRenderTimeline();
        this._tbRenderStats();
        this._tbRenderBalans();
        this._tbRenderPool();
        this._tbRenderTemplates();
        this._tbStartNuTicker();
    }

    async _tbOffsetDays(delta) {
        const next = new Date(this._tbDate.getTime() + delta * 86400000);
        next.setHours(0, 0, 0, 0);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (next.getTime() < today.getTime()) return; // floor at today
        this._tbDate = next;
        // Switching days invalidates per-day state.
        this._tbBlocksOverrides = new Map();
        this._tbExtraBlocks = [];
        this._tbScheduledTaskIds = new Set();
        // Immediate render so the schema reflects the new active date even
        // before the calendar fetch completes (empty calendar events shown).
        this.renderTodaySchema();
        // Fetch the new day's calendar events; the function calls
        // renderTodaySchema again after the events land.
        if (typeof this.refreshTodayAgenda === "function") {
            await this.refreshTodayAgenda(true);
            // Defensive: ensure the schema (and balance) reflect the freshly
            // loaded events. refreshTodayAgenda only re-renders when in the
            // today view, but we call it again here unconditionally because
            // we know we are on Today (the stepper isn't shown otherwise).
            this.renderTodaySchema();
        }
    }

    _tbActiveDateKey() {
        const d = this._tbDate;
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
    }

    _tbRenderDayStep() {
        const label = document.getElementById("tbDayStepLabel");
        const prev = document.getElementById("tbPrevDayBtn");
        if (!label) return;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const days = ["zondag","maandag","dinsdag","woensdag","donderdag","vrijdag","zaterdag"];
        const months = ["jan","feb","mrt","apr","mei","jun","jul","aug","sep","okt","nov","dec"];
        const isToday = this._tbDate.getTime() === today.getTime();
        if (isToday) {
            label.textContent = "Vandaag";
        } else {
            label.textContent = `${days[this._tbDate.getDay()]} ${this._tbDate.getDate()} ${months[this._tbDate.getMonth()]}`;
        }
        if (prev) prev.disabled = isToday;
    }

    _tbStartNuTicker() {
        if (this._tbNuTimer) clearInterval(this._tbNuTimer);
        const tick = () => {
            if (!this.todayView || this.todayView.hidden) {
                clearInterval(this._tbNuTimer);
                this._tbNuTimer = null;
                return;
            }
            this._tbUpdateNu();
        };
        this._tbNuTimer = setInterval(tick, 60 * 1000);
    }

    _tbRenderStats() {
        const subEl = document.getElementById("tbScheduleSub");
        if (!subEl) return;
        if (this._tbBlocks.length === 0) {
            subEl.textContent = "Nog niets gepland vandaag.";
            return;
        }
        const first = this._tbBlocks.reduce((acc, b) => Math.min(acc, this._tbParseTime(b.start)), 24*60);
        const last  = this._tbBlocks.reduce((acc, b) => Math.max(acc, this._tbParseTime(b.end)), 0);
        subEl.textContent = `${this._tbFormatTime(first)} – ${this._tbFormatTime(last)} · ${this._tbBlocks.length} blokken`;
    }

    _tbCountBuffers() {
        const sorted = [...this._tbBlocks].sort((a, b) => this._tbParseTime(a.start) - this._tbParseTime(b.start));
        let buffers = 0;
        for (let i = 1; i < sorted.length; i++) {
            const gap = this._tbParseTime(sorted[i].start) - this._tbParseTime(sorted[i-1].end);
            if (gap >= 15 && gap <= 45) buffers++;
        }
        return buffers;
    }

    _tbRenderBalans() {
        const s = this._tbStats();
        const numEl = document.getElementById("tbBalansNum");
        if (numEl) {
            const h = Math.floor(s.totals.total / 60);
            const m = s.totals.total % 60;
            numEl.innerHTML = `<em>${h}</em><span class="u">u</span> <em>${String(m).padStart(2, "0")}</em><sup>m</sup>`;
        }
        const pctEl = document.getElementById("tbBalansPct");
        if (pctEl) {
            const cap = s.cap || 1;
            const pct = Math.min(100, Math.round((s.totals.total / cap) * 100));
            pctEl.textContent = `${pct}%`;
        }
        // Categories mirror the next-week time-budget block (labels + colors).
        const cap = s.cap || 1;
        const focusPct  = Math.min(100, ((s.totals.focus   || 0) / cap) * 100);
        const meetPct   = Math.min(100, ((s.totals.meeting || 0) / cap) * 100);
        const familyPct = Math.min(100, ((s.totals.family  || 0) / cap) * 100);
        const rustPct   = Math.min(100, ((s.totals.rust    || 0) / cap) * 100);
        const usedPct   = focusPct + meetPct + familyPct + rustPct;
        const freePct   = Math.max(0, 100 - usedPct);
        const bar = document.getElementById("tbCapacityBar");
        if (bar) {
            bar.innerHTML = `
                <i class="seg seg-focus" style="width:${focusPct}%;"></i>
                <i class="seg seg-meet" style="width:${meetPct}%;"></i>
                <i class="seg seg-family" style="width:${familyPct}%;"></i>
                <i class="seg seg-rust" style="width:${rustPct}%;"></i>
                <i class="seg seg-free" style="width:${freePct}%;"></i>
            `;
        }
        const legend = document.getElementById("tbCapacityLegend");
        if (legend) {
            legend.innerHTML = `
                <span><i style="background:var(--ink);"></i>Diep werk <b>${this._tbFormatMins(s.totals.focus || 0)}</b></span>
                <span><i style="background:var(--ink-tertiary);"></i>Meeting <b>${this._tbFormatMins(s.totals.meeting || 0)}</b></span>
                <span><i style="background:var(--area-3);"></i>Familie &amp; vrienden <b>${this._tbFormatMins(s.totals.family || 0)}</b></span>
                <span><i style="background:var(--ink-secondary);"></i>Rust <b>${this._tbFormatMins(s.totals.rust || 0)}</b></span>
                <span><i style="background:var(--border-strong);"></i>Vrij <b>${this._tbFormatMins(s.free)}</b></span>
            `;
        }
    }

    _tbRenderAreas() {
        const s = this._tbStats();
        const areas = this._tbAreas();
        const rows = areas
            .map((a) => ({ ...a, mins: s.perArea[a.id] || 0 }))
            .sort((x, y) => y.mins - x.mins);
        const maxMins = Math.max(1, ...rows.map((r) => r.mins));
        const list = document.getElementById("tbAreaList");
        if (!list) return;
        list.innerHTML = rows.map((r) => `
            <li class="tb-area-row">
                <div class="tb-area-head">
                    <span class="name"><span class="dot" style="background:${r.color};"></span>${this.escapeHtml(r.name)}</span>
                    <span class="hrs">${this._tbFormatMins(r.mins)}</span>
                </div>
                <div class="tb-area-bar"><i style="width:${(r.mins / maxMins) * 100}%;background:${r.color};"></i></div>
            </li>
        `).join("");
    }

    _tbRenderPool() {
        const total = this._tbPool.reduce((acc, p) => acc + p.est, 0);
        const plannedCount = this._tbPool.filter((p) => p.planned).length;
        const badge = document.getElementById("tbPoolBadge");
        if (badge) {
            const base = `${this._tbPool.length} taken · ${this._tbFormatMins(total)}`;
            badge.textContent = plannedCount ? `${base} · ${plannedCount} gepland` : base;
        }
        const list = document.getElementById("tbPoolList");
        if (!list) return;
        list.innerHTML = this._tbPool.map((p) => `
            <li class="tb-pool-item${p.planned ? " is-planned" : ""}" draggable="true" data-tb-pool-id="${p.id}">
                <span class="dot" style="background:${this._tbAreaColor(p.area)};"></span>
                <span class="body">
                    <span class="t">${this.escapeHtml(p.title)}</span>
                    <span class="m">${this.escapeHtml(p.meta)}</span>
                </span>
                ${p.planned ? `<span class="tb-pool-planned">Gepland</span>` : ""}
                <span class="est">${p.est}m</span>
                <span class="grip" aria-hidden="true"><span><i></i><i></i></span><span><i></i><i></i></span><span><i></i><i></i></span></span>
            </li>
        `).join("");
    }

    _tbRenderTemplates() {
        const list = document.getElementById("tbTplList");
        if (!list) return;
        list.innerHTML = this._tbTemplates().map((t) => `
            <li class="tb-tpl-item" draggable="true" data-tb-tpl-id="${t.id}">
                <span class="tb-tpl-icon ${t.dark ? "dark" : ""}">${t.letter}</span>
                <span class="tb-tpl-body">
                    <span class="tb-tpl-name">${this.escapeHtml(t.name)}</span>
                    <span class="tb-tpl-desc">${this.escapeHtml(t.desc)}</span>
                </span>
                <span class="tb-tpl-dur">${t.dur}m</span>
            </li>
        `).join("");
    }

    _tbRenderTimeline() {
        const startHour = 6;
        const endHour = 22;   // last full hour mark (22:00) shown; bottom is 22:30
        const hourPx = 52;
        const totalMinutes = (endHour + 0.5 - startHour) * 60; // 16.5h → 990 min
        const totalHeight = (totalMinutes / 60) * hourPx;
        const wrap = document.getElementById("tbTimeline");
        if (!wrap) return;

        const minsToTop = (mins) => ((mins - startHour * 60) / 60) * hourPx;

        // Hour ticks
        let ticks = "";
        for (let h = startHour; h <= endHour; h++) {
            const top = (h - startHour) * hourPx;
            ticks += `
                <div class="tb-hour-row" style="top:${top}px;">
                    <span class="tb-hour-label">${String(h).padStart(2,"0")}:00</span>
                    <span class="tb-hour-line ${h === 12 ? "midday" : ""}"></span>
                </div>
            `;
            const halfTop = top + 26;
            if (h < endHour + 0.5) {
                ticks += `<div class="tb-hour-row" style="top:${halfTop}px;"><span class="tb-hour-line half"></span></div>`;
            }
        }

        // Sort blocks by start
        const blocks = [...this._tbBlocks].sort((a, b) => this._tbParseTime(a.start) - this._tbParseTime(b.start));

        const nowMins = (() => {
            const isToday = this._tbDate.toDateString() === new Date().toDateString();
            if (!isToday) return null;
            const n = new Date();
            return n.getHours() * 60 + n.getMinutes();
        })();

        // Block HTML
        const blockHtml = blocks.map((b) => {
            const s = this._tbParseTime(b.start);
            const e = this._tbParseTime(b.end);
            const dur = e - s;
            const top = minsToTop(s);
            const height = (dur / 60) * hourPx - 4;
            const isPast = nowMins != null && e < nowMins;
            const isCurrent = nowMins != null && s <= nowMins && e > nowMins;
            const isTiny = dur <= 15;
            const isShort = dur <= 30;
            const accent = this._tbAreaColor(b.area);

            const draggable = b.kind !== "calendar";
            return `
                <div class="tb-block ${b.type} ${isPast ? "past" : ""} ${isCurrent ? "current" : ""} ${isTiny ? "tiny" : ""} ${isShort ? "short" : ""} ${b.calendarImported ? "calendar-imported" : ""} ${draggable ? "is-movable" : "is-locked"}"
                     style="top:${top}px;height:${Math.max(22, height)}px;"
                     data-tb-block-id="${b.id}" data-tb-block-kind="${b.kind || "extra"}" draggable="${draggable}">
                    <span class="tb-rail-accent" style="background:${accent};"></span>
                    <div class="tb-block-row">
                        <span class="tb-block-title">${this.escapeHtml(b.title)}${isCurrent ? `<span class="bezig-badge"><span class="live"></span>Bezig</span>` : ""}</span>
                        <span class="tb-block-time">${b.start} — ${b.end}</span>
                    </div>
                    <span class="tb-resize" data-tb-resize="${b.id}"></span>
                </div>
            `;
        }).join("");

        // Day end (used by the now-line bounds check)
        const dayEnd = Math.floor((endHour + 0.5) * 60);

        // Now line
        let nuHtml = "";
        if (nowMins != null && nowMins >= startHour * 60 && nowMins <= dayEnd) {
            const top = minsToTop(nowMins);
            nuHtml = `
                <div class="tb-nu-line" style="top:${top - 9}px;height:18px;">
                    <span class="tb-nu-label">NU ${this._tbFormatTime(nowMins)}</span>
                    <span class="dot"></span>
                    <span class="line"></span>
                </div>
            `;
        }

        wrap.innerHTML = `
            <div class="tb-timeline-inner" style="height:${totalHeight}px;">
                ${ticks}
                ${blockHtml}
                ${nuHtml}
                <div class="tb-drop-indicator" hidden><span class="tb-drop-label"></span></div>
            </div>
        `;

        this._tbBindTimelineEvents();
    }

    _tbUpdateNu() {
        const wrap = document.getElementById("tbTimeline");
        if (!wrap) return;
        const isToday = this._tbDate.toDateString() === new Date().toDateString();
        const old = wrap.querySelector(".tb-nu-line");
        if (old) old.remove();
        if (!isToday) {
            this._tbRefreshCurrentRing(null);
            return;
        }
        const n = new Date();
        const nowMins = n.getHours() * 60 + n.getMinutes();
        const hourPx = 52;
        const startHour = 6;
        const top = ((nowMins - startHour * 60) / 60) * hourPx;
        const inner = wrap.querySelector(".tb-timeline-inner");
        if (!inner) return;
        const html = `
            <div class="tb-nu-line" style="top:${top - 9}px;height:18px;">
                <span class="tb-nu-label">NU ${this._tbFormatTime(nowMins)}</span>
                <span class="dot"></span>
                <span class="line"></span>
            </div>
        `;
        inner.insertAdjacentHTML("beforeend", html);
        this._tbRefreshCurrentRing(nowMins);
    }

    _tbRefreshCurrentRing(nowMins) {
        const wrap = document.getElementById("tbTimeline");
        if (!wrap) return;
        wrap.querySelectorAll(".tb-block").forEach((el) => {
            el.classList.remove("current", "past");
            const id = Number(el.dataset.tbBlockId);
            const block = this._tbBlocks.find((b) => b.id === id);
            if (!block || nowMins == null) return;
            const s = this._tbParseTime(block.start);
            const e = this._tbParseTime(block.end);
            if (e < nowMins) el.classList.add("past");
            else if (s <= nowMins && e > nowMins) el.classList.add("current");
        });
    }

    _tbBindTimelineEvents() {
        const wrap = document.getElementById("tbTimeline");
        if (!wrap || wrap.dataset.tbBound === "1") return;
        wrap.dataset.tbBound = "1";

        // Block click → open sheet
        wrap.addEventListener("click", (event) => {
            const block = event.target.closest(".tb-block");
            if (block) {
                const id = block.dataset.tbBlockId;
                this._tbOpenSheet(id);
            }
        });

        // Drag a pool item / template onto the timeline to schedule a block.
        const computeDropMins = (clientY) => {
            const inner = wrap.querySelector(".tb-timeline-inner");
            if (!inner) return null;
            const rect = inner.getBoundingClientRect();
            const y = clientY - rect.top;
            const hourPx = 52;
            const startHour = 6;
            let mins = startHour * 60 + (y / hourPx) * 60;
            mins = Math.round(mins / 15) * 15;
            const endHour = 22;
            const dayStart = startHour * 60;
            const dayEnd = Math.floor((endHour + 0.5) * 60);
            mins = Math.max(dayStart, Math.min(dayEnd - 15, mins));
            return mins;
        };
        const getDragMeta = () => this._tbDragMeta || null;

        wrap.addEventListener("dragover", (event) => {
            event.preventDefault();
            // "move" so a successful timeline drop is distinguishable from a
            // cancelled drag (dropEffect="none") in the dragend handler.
            event.dataTransfer.dropEffect = "move";
            const meta = getDragMeta();
            if (!meta) return;
            const mins = computeDropMins(event.clientY);
            if (mins == null) return;
            const dur = meta.dur || 30;
            const hourPx = 52;
            const startHour = 6;
            const top = ((mins - startHour * 60) / 60) * hourPx;
            const height = (dur / 60) * hourPx - 4;
            const ind = wrap.querySelector(".tb-drop-indicator");
            if (!ind) return;
            ind.hidden = false;
            ind.style.top = `${top}px`;
            ind.style.height = `${Math.max(22, height)}px`;
            const label = ind.querySelector(".tb-drop-label");
            if (label) {
                label.textContent = `${this._tbFormatTime(mins)} — ${this._tbFormatTime(mins + dur)} · ${meta.title || ""}`;
            }
        });
        wrap.addEventListener("dragleave", (event) => {
            if (event.target === wrap || !wrap.contains(event.relatedTarget)) {
                const ind = wrap.querySelector(".tb-drop-indicator");
                if (ind) ind.hidden = true;
            }
        });
        wrap.addEventListener("drop", (event) => {
            event.preventDefault();
            const ind = wrap.querySelector(".tb-drop-indicator");
            if (ind) ind.hidden = true;
            const data = event.dataTransfer.getData("text/plain");
            if (!data) return;
            const payload = (() => { try { return JSON.parse(data); } catch (_) { return null; } })();
            if (!payload) return;

            const mins = computeDropMins(event.clientY);
            if (mins == null) return;

            this._tbDropHandled = true;
            if (payload.kind === "block") {
                this._tbMoveBlock(payload.id, mins);
                return;
            } else if (payload.kind === "pool") {
                const item = this._tbPool.find((p) => p.id === payload.id);
                if (!item) return;
                const newId = this._tbInsertBlock({
                    title: item.title,
                    type: "focus",
                    area: item.area,
                    durMin: item.est,
                    startMin: mins,
                    chip: "Diep werk",
                    fromTaskId: item.taskId,
                });
                if (item.taskId != null) this._tbScheduledTaskIds.add(item.taskId);
                void newId;
            } else if (payload.kind === "tpl") {
                const tpl = this._tbTemplates().find((t) => t.id === payload.id);
                if (!tpl) return;
                this._tbInsertBlock({
                    title: tpl.name,
                    type: tpl.type,
                    area: tpl.area,
                    durMin: tpl.dur,
                    startMin: mins,
                    chip: tpl.name,
                });
            }
            this._tbRender();
        });
    }

    _tbInsertBlock(opts) {
        const start = Math.max(0, Math.min(24 * 60 - opts.durMin, opts.startMin));
        this._tbExtraSeq = (this._tbExtraSeq || 0) + 1;
        const id = `extra-${this._tbExtraSeq}`;
        const block = {
            id,
            kind: "extra",
            start: this._tbFormatTime(start),
            end: this._tbFormatTime(start + opts.durMin),
            title: opts.title,
            type: opts.type,
            area: opts.area || this._tbFallbackAreaId(),
            chip: opts.chip,
            pomos: opts.type === "focus" ? Math.max(1, Math.round(opts.durMin / 30)) : 0,
            pomosDone: 0,
            fromTaskId: opts.fromTaskId ?? null,
        };
        this._tbExtraBlocks.push(block);
        return id;
    }

    _tbAddBlockAt(start, end) {
        const id = this._tbInsertBlock({
            title: "Nieuw blok",
            type: "focus",
            area: this._tbFallbackAreaId(),
            durMin: end - start,
            startMin: start,
            chip: "Diep werk",
        });
        this._tbRender();
        this._tbOpenSheet(id);
    }

    _tbRender() {
        this._tbEnsureData();
        this._tbRenderTimeline();
        this._tbRenderStats();
        this._tbRenderBalans();
        this._tbRenderPool();
    }

    _tbOpenSheet(id) {
        const block = this._tbBlocks.find((b) => String(b.id) === String(id));
        if (!block) return;
        this._tbEditingId = String(id);
        const sheet = document.getElementById("tbSheet");
        if (!sheet) return;
        const titleInput = document.getElementById("tbSheetTitleInput");
        const startInput = document.getElementById("tbSheetStart");
        const durInput = document.getElementById("tbSheetDuration");
        const typeSel = document.getElementById("tbSheetType");
        const areaSel = document.getElementById("tbSheetArea");
        const pomosInput = document.getElementById("tbSheetPomos");
        const protectInput = document.getElementById("tbSheetProtect");
        if (titleInput) titleInput.value = block.title;
        if (startInput) startInput.value = block.start;
        if (durInput) durInput.value = String(this._tbParseTime(block.end) - this._tbParseTime(block.start));
        if (typeSel) typeSel.value = block.type;
        if (areaSel) {
            areaSel.innerHTML = this._tbAreas().map((a) => `<option value="${a.id}">${a.name}</option>`).join("");
            areaSel.value = String(block.area);
        }
        if (pomosInput) pomosInput.value = String(block.pomos || 0);
        if (protectInput) protectInput.checked = !!block.protect;
        sheet.hidden = false;
    }

    _tbCloseSheet() {
        const sheet = document.getElementById("tbSheet");
        if (sheet) sheet.hidden = true;
        this._tbEditingId = null;
    }

    _tbSaveSheet() {
        if (!this._tbEditingId) return;
        const id = this._tbEditingId;
        const titleInput = document.getElementById("tbSheetTitleInput");
        const startInput = document.getElementById("tbSheetStart");
        const durInput = document.getElementById("tbSheetDuration");
        const typeSel = document.getElementById("tbSheetType");
        const areaSel = document.getElementById("tbSheetArea");
        const pomosInput = document.getElementById("tbSheetPomos");
        const protectInput = document.getElementById("tbSheetProtect");
        const current = this._tbBlocks.find((b) => String(b.id) === id);
        if (!current) return;
        const startMin = this._tbParseTime(startInput.value || current.start);
        const dur = Math.max(15, Number(durInput.value) || 30);
        const snappedDur = Math.round(dur / 15) * 15;
        const patch = {
            title: titleInput.value.trim() || "Blok",
            start: this._tbFormatTime(startMin),
            end: this._tbFormatTime(startMin + snappedDur),
            type: typeSel.value,
            area: Number(areaSel.value),
            pomos: Math.max(0, Number(pomosInput.value) || 0),
            protect: protectInput.checked,
        };
        const extra = this._tbExtraBlocks.find((b) => String(b.id) === id);
        if (extra) {
            Object.assign(extra, patch);
        } else {
            this._tbBlocksOverrides.set(id, { ...(this._tbBlocksOverrides.get(id) || {}), ...patch });
        }
        this._tbCloseSheet();
        this._tbRender();
    }

    _tbMoveBlock(id, newStartMin) {
        const block = this._tbBlocks.find((b) => String(b.id) === String(id));
        if (!block) return;
        const dur = this._tbParseTime(block.end) - this._tbParseTime(block.start);
        const startHour = 6;
        const endHour = 22;
        const dayStart = startHour * 60;
        const dayEnd = Math.floor((endHour + 0.5) * 60);
        const newStart = Math.max(dayStart, Math.min(dayEnd - dur, newStartMin));
        const patch = {
            start: this._tbFormatTime(newStart),
            end: this._tbFormatTime(newStart + dur),
        };
        const extra = this._tbExtraBlocks.find((b) => String(b.id) === String(id));
        if (extra) {
            Object.assign(extra, patch);
        } else {
            this._tbBlocksOverrides.set(String(id), {
                ...(this._tbBlocksOverrides.get(String(id)) || {}),
                ...patch,
            });
        }
        this._tbRender();
    }

    _tbRemoveBlock(id) {
        // Find block by id across the rendered set to know its kind.
        const block = this._tbBlocks.find((b) => String(b.id) === String(id));
        if (!block) return;
        // Extras: drop from the in-memory list.
        const extraIdx = this._tbExtraBlocks.findIndex((b) => String(b.id) === String(id));
        if (extraIdx >= 0) {
            const removed = this._tbExtraBlocks.splice(extraIdx, 1)[0];
            if (removed && removed.fromTaskId != null) {
                this._tbScheduledTaskIds.delete(removed.fromTaskId);
            }
        } else if (block.kind === "task" && block.taskId != null) {
            // Task block dropped onto the pool → unschedule (becomes pool item again).
            this._tbScheduledTaskIds.delete(block.taskId);
            this._tbBlocksOverrides.set(String(id), {
                ...(this._tbBlocksOverrides.get(String(id)) || {}),
                _hidden: true,
            });
        } else {
            // Calendar (or other derived) → hide via override.
            this._tbBlocksOverrides.set(String(id), {
                ...(this._tbBlocksOverrides.get(String(id)) || {}),
                _hidden: true,
            });
        }
        this._tbRender();
    }

    _tbDeleteSheet() {
        if (!this._tbEditingId) return;
        const id = this._tbEditingId;
        const extraIdx = this._tbExtraBlocks.findIndex((b) => String(b.id) === id);
        if (extraIdx >= 0) {
            this._tbExtraBlocks.splice(extraIdx, 1);
        } else {
            // For calendar/task blocks we don't truly delete — just hide via override.
            this._tbBlocksOverrides.set(id, { ...(this._tbBlocksOverrides.get(id) || {}), _hidden: true });
        }
        this._tbCloseSheet();
        this._tbRender();
    }

    _tbBindOnce() {
        if (this._tbBound) return;
        this._tbBound = true;

        // Day stepper (today + forward only)
        document.getElementById("tbPrevDayBtn")?.addEventListener("click", () => {
            this._tbOffsetDays(-1);
        });
        document.getElementById("tbNextDayBtn")?.addEventListener("click", () => {
            this._tbOffsetDays(+1);
        });

        // Sheet
        document.getElementById("tbSheetClose")?.addEventListener("click", () => this._tbCloseSheet());
        document.getElementById("tbSheetSave")?.addEventListener("click", () => this._tbSaveSheet());
        document.getElementById("tbSheetDelete")?.addEventListener("click", () => this._tbDeleteSheet());
        document.getElementById("tbSheet")?.addEventListener("click", (event) => {
            if (event.target.id === "tbSheet") this._tbCloseSheet();
        });

        // Drag start for pool + templates (delegated)
        document.addEventListener("dragstart", (event) => {
            const pool = event.target.closest("[data-tb-pool-id]");
            if (pool) {
                pool.classList.add("dragging");
                event.dataTransfer.setData("text/plain", JSON.stringify({ kind: "pool", id: pool.dataset.tbPoolId }));
                event.dataTransfer.effectAllowed = "copy";
                const item = this._tbPool.find((p) => p.id === pool.dataset.tbPoolId);
                this._tbDragMeta = item ? { dur: item.est, title: item.title } : null;
                this._tbDropHandled = false;
                document.body.classList.add("tb-dragging");
                return;
            }
            const tpl = event.target.closest("[data-tb-tpl-id]");
            if (tpl) {
                tpl.classList.add("dragging");
                event.dataTransfer.setData("text/plain", JSON.stringify({ kind: "tpl", id: tpl.dataset.tbTplId }));
                event.dataTransfer.effectAllowed = "copy";
                const t = this._tbTemplates().find((x) => x.id === tpl.dataset.tbTplId);
                this._tbDragMeta = t ? { dur: t.dur, title: t.name } : null;
                this._tbDropHandled = false;
                document.body.classList.add("tb-dragging");
                return;
            }
            const block = event.target.closest(".tb-block");
            if (block) {
                const blockKind = block.dataset.tbBlockKind || "extra";
                if (blockKind === "calendar") {
                    event.preventDefault();
                    return;
                }
                block.classList.add("dragging");
                const id = block.dataset.tbBlockId;
                const data = this._tbBlocks.find((b) => String(b.id) === String(id));
                const dur = data
                    ? this._tbParseTime(data.end) - this._tbParseTime(data.start)
                    : 30;
                event.dataTransfer.setData("text/plain", JSON.stringify({ kind: "block", id, blockKind }));
                event.dataTransfer.effectAllowed = "move";
                this._tbDragMeta = { dur, title: data ? data.title : "" };
                this._tbDropHandled = false;
                document.body.classList.add("tb-dragging");
            }
        });
        document.addEventListener("dragend", (event) => {
            const dragged = event.target.closest?.(".dragging");
            // If the drop did not land on a recognised target, remove the block
            // (task / extra only). Calendar blocks aren't draggable.
            const handled = this._tbDropHandled === true;
            if (
                dragged &&
                dragged.classList.contains("tb-block") &&
                !handled
            ) {
                const kind = dragged.dataset.tbBlockKind;
                if (kind === "task" || kind === "extra") {
                    this._tbRemoveBlock(dragged.dataset.tbBlockId);
                }
            }
            dragged?.classList.remove("dragging");
            this._tbDragMeta = null;
            this._tbDropHandled = false;
            document.body.classList.remove("tb-dragging");
            document.querySelectorAll(".tb-drop-indicator").forEach((el) => { el.hidden = true; });
            document.querySelectorAll(".tb-pool-list.drag-over").forEach((el) => el.classList.remove("drag-over"));
        });

        // Drop a block back onto the Te doen pool → remove the block & unplan the task.
        const poolList = document.getElementById("tbPoolList");
        if (poolList) {
            poolList.addEventListener("dragover", (event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                poolList.classList.add("drag-over");
            });
            poolList.addEventListener("dragleave", (event) => {
                if (!poolList.contains(event.relatedTarget)) {
                    poolList.classList.remove("drag-over");
                }
            });
            poolList.addEventListener("drop", (event) => {
                event.preventDefault();
                poolList.classList.remove("drag-over");
                const data = event.dataTransfer.getData("text/plain");
                if (!data) return;
                const payload = (() => { try { return JSON.parse(data); } catch (_) { return null; } })();
                if (!payload || payload.kind !== "block") return;
                this._tbDropHandled = true;
                this._tbRemoveBlock(String(payload.id));
            });
        }
    }

    _tbAutoPlan() {
        // Simple heuristic: move all pool items into available gaps,
        // earliest-first; focus blocks before lunch, others after.
        const blocks = [...this._tbBlocks].sort((a, b) => this._tbParseTime(a.start) - this._tbParseTime(b.start));
        const startHour = 6;
        const endHour = 22.5;
        const gaps = [];
        let cursor = startHour * 60;
        for (const b of blocks) {
            const s = this._tbParseTime(b.start);
            if (s > cursor) gaps.push({ start: cursor, end: s });
            cursor = Math.max(cursor, this._tbParseTime(b.end));
        }
        if (cursor < endHour * 60) gaps.push({ start: cursor, end: endHour * 60 });

        const pool = [...this._tbPool].sort((a, b) => b.est - a.est);
        for (const item of pool) {
            const fitIdx = gaps.findIndex((g) => g.end - g.start >= item.est);
            if (fitIdx < 0) continue;
            const g = gaps[fitIdx];
            this._tbInsertBlock({
                title: item.title,
                type: "focus",
                area: item.area,
                durMin: item.est,
                startMin: g.start,
                chip: "Diep werk",
            });
            if (item.taskId != null) this._tbScheduledTaskIds.add(item.taskId);
            g.start += item.est;
            if (g.end - g.start < 15) gaps.splice(fitIdx, 1);
        }
        this._tbRender();
    }

}

const app = new TodoApp();
