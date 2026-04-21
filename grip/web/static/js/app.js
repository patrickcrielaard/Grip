// Grip To-Do App - Frontend JavaScript (Supabase-backed)

class TodoApp {
    constructor() {
        this.todos = [];
        this.projects = [];
        this.completedProjects = [];
        this.areas = [];
        this.goals = [];
        this.currentView = { type: "list", value: "inbox" };
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
        this.todayAgendaOpen = localStorage.getItem("gripTodayAgendaOpen") === "1";
        this._statusTimer = null;
        this.cacheElements();
        this.bindEvents();
        this.boot();
    }

    async boot() {
        // Load areas & goals first so the sidebar tree and selects can render
        // with the correct data before todos/projects trigger re-renders.
        await Promise.all([this.loadAreas(), this.loadGoals()]);
        this.renderAreaTree();
        this._populateAreaSelects();
        await Promise.all([this.loadProjects(), this.loadCompletedProjects(), this.loadTodos()]);
        this.loadCalendarSubscriptions();
    }

    cacheElements() {
        this.todoInput = document.getElementById("todoInput");
        this.addButton = document.getElementById("addBtn");
        this.addTaskToggle = document.getElementById("addTaskToggle");
        this.addTaskRow = document.getElementById("addTaskRow");
        this.areaSelect = document.getElementById("areaSelect");
        this.prioritySelect = document.getElementById("prioritySelect");
        this.startDateInput = document.getElementById("startDateInput");
        this.plannedDateInput = document.getElementById("plannedDateInput");
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
        this.projectNav = document.getElementById("projectNav");
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
        this.calendarModalError = document.getElementById("calendarModalError");
        this.todayAgendaToggle = document.getElementById("todayAgendaToggle");
        this.todayAgendaPanel = document.getElementById("todayAgendaPanel");
        this.todayAgendaList = document.getElementById("todayAgendaList");
        this.todayAgendaTitle = document.getElementById("todayAgendaTitle");
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

        // Add task submit
        this.addButton.addEventListener("click", () => this.addTodo());
        this.todoInput.addEventListener("keypress", (event) => {
            if (event.key === "Enter") {
                this.addTodo();
            }
        });

        // Sidebar navigation (only static todoNav items — areas/goals/projects are delegated)
        this.sidebarItems.forEach((item) => {
            item.addEventListener("click", () => {
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

        // Clear completed
        if (this.clearCompletedButton) {
            this.clearCompletedButton.addEventListener("click", () =>
                this.clearCompleted()
            );
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

        // Close menus on outside click
        document.addEventListener("click", (event) => {
            if (!event.target.closest(".todo-actions")) {
                this.closeAllMenus();
            }
        });

        // Escape to close menus, modal, and hide add-task row
        document.addEventListener("keydown", (event) => {
            if (event.key === "Escape") {
                this.closeAllMenus();
                this.closeModal();
                this.hideAddTask();
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

        // Modal title auto-save on blur
        this.modalTitleInput.addEventListener("blur", () => this.saveModalTitle());
        this.modalTitleInput.addEventListener("keydown", (event) => {
            if (event.key === "Enter") this.modalTitleInput.blur();
        });

        // Modal field auto-save on change + immediate visual state sync
        // (date fields are handled by the custom date picker, not change events)
        [
            { el: this.modalState,    field: "state" },
            { el: this.modalList,     field: "list" },
            { el: this.modalDuration, field: "duration" },
            { el: this.modalPriority, field: "priority" },
            { el: this.modalArea,     field: "area" },
            { el: this.modalProject,  field: "project" },
        ].forEach(({ el, field }) => {
            if (!el) return;
            el.addEventListener("change", () => {
                this._syncModalFieldStates();
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
                }
            });
        }
        // Today agenda panel toggle
        if (this.todayAgendaToggle) {
            this.todayAgendaToggle.addEventListener("click", () => {
                this.todayAgendaOpen = !this.todayAgendaOpen;
                localStorage.setItem("gripTodayAgendaOpen", this.todayAgendaOpen ? "1" : "0");
                this._applyCalendarChrome();
                if (this.todayAgendaOpen) this.refreshTodayAgenda();
            });
        }

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
    }

    // --- Add task toggle ---

    toggleAddTask() {
        this.addTaskVisible = !this.addTaskVisible;
        this.addTaskRow.hidden = !this.addTaskVisible;
        if (this.addTaskVisible) {
            if (this.projectSelect && this.currentView.type === "project") {
                this.projectSelect.value = String(this.currentView.value);
            }
            this.todoInput.focus();
        }
    }

    hideAddTask() {
        this.addTaskVisible = false;
        this.addTaskRow.hidden = true;
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

        // Show archive button only when viewing an active project
        if (this.projectActionsEl) {
            const isActiveProject = view.type === "project" &&
                this.projects.some(p => p.id === view.value && (p.status === undefined || p.status === "active"));
            this.projectActionsEl.hidden = !isActiveProject;
        }

        this._applyCalendarChrome();
        this.renderTodos();
        if (view.type === "view" && (view.value === "week" || view.value === "next-week")) {
            const offset = view.value === "next-week" ? 1 : 0;
            const range = this.getWeekRange(offset);
            this.loadCalendarEvents(range.start, range.end).then(() =>
                this.renderTodos()
            );
        }
        if (this._isTodayView() && this.todayAgendaOpen) {
            this.refreshTodayAgenda();
        }
    }

    _isTodayView() {
        return this.currentView.type === "list" && this.currentView.value === "today";
    }

    _applyCalendarChrome() {
        const isToday = this._isTodayView();
        if (this.todayAgendaToggle) {
            this.todayAgendaToggle.hidden = !isToday;
            this.todayAgendaToggle.setAttribute("aria-pressed", String(this.todayAgendaOpen));
            this.todayAgendaToggle.classList.toggle("is-active", isToday && this.todayAgendaOpen);
        }
        const showPanel = isToday && this.todayAgendaOpen;
        if (this.todayAgendaPanel) this.todayAgendaPanel.hidden = !showPanel;
        document.body.classList.toggle("with-today-agenda", showPanel);
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
                const project = this.projects.find(p => p.id === this.currentView.value);
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
            const expanded = this.expandedAreaIds.has(area.id);
            const goalsInArea = this.goals.filter(
                (g) => g.area_id === area.id && g.status !== "archived"
            );
            const projectsInArea = activeProjects.filter(
                (p) => p.area_id === area.id && !p.goal_id
            );
            const hasChildren = goalsInArea.length > 0 || projectsInArea.length > 0;

            const chevron = hasChildren
                ? `<button class="tree-toggle" type="button" data-kind="area" data-id="${area.id}" aria-expanded="${expanded}" aria-label="Toggle"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="${expanded ? "6 9 12 15 18 9" : "9 18 15 12 9 6"}"/></svg></button>`
                : `<span class="tree-toggle tree-toggle-placeholder"></span>`;

            let html = `
                <div class="tree-node tree-area ${extraClass}" data-tree-node="area" data-id="${area.id}" role="button" aria-pressed="false">
                    ${chevron}
                    <span class="area-swatch" style="background:${this.escapeHtml(area.color)}"></span>
                    <span class="tree-label">${this.escapeHtml(area.name)}</span>
                    <span class="tree-actions">
                        <button class="tree-action add-goal-btn" type="button" title="Nieuw doel" data-area-id="${area.id}" aria-label="Nieuw doel">+ Doel</button>
                        <button class="tree-action add-project-btn" type="button" title="Nieuw project" data-area-id="${area.id}" aria-label="Nieuw project">+</button>
                    </span>
                    <span class="sidebar-count tree-count" data-count-area="${area.id}"></span>
                </div>`;

            if (expanded && hasChildren) {
                html += `<div class="tree-children">`;
                goalsInArea.forEach((goal) => {
                    html += renderGoal(goal);
                });
                projectsInArea.forEach((project) => {
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

        // Render completed projects in archive section
        const archivedSection = document.getElementById("projectsArchivedSection");
        const archivedNav = document.getElementById("projectArchivedNav");
        if (completedProjects.length > 0) {
            archivedSection.style.display = "block";
            archivedNav.innerHTML = completedProjects
                .map(project => `
                    <button class="sidebar-item project-completed" type="button" data-project-filter="${project.id}" aria-pressed="false">
                        <svg class="sidebar-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                        </svg>
                        <span class="sidebar-label">${this.escapeHtml(project.name)}</span>
                        <span class="sidebar-count" data-count-project="${project.id}"></span>
                    </button>`)
                .join("");
        } else {
            archivedSection.style.display = "none";
            archivedNav.innerHTML = "";
        }

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

    _populateProjectSelects() {
        const activeProjects = this.projects.filter(p => p.status === undefined || p.status === "active");
        const options = `<option value="">Geen project</option>` +
            activeProjects.map(p =>
                `<option value="${p.id}">${this.escapeHtml(p.name)}</option>`
            ).join("");
        if (this.projectSelect) this.projectSelect.innerHTML = options;
        if (this.modalProject) {
            const current = this.modalProject.value;
            this.modalProject.innerHTML = options;
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
        const deadline = this.deadlineInput?.value || null;
        const duration = this.durationInput?.value ? Number(this.durationInput.value) : null;
        const recurrenceUnitVal = this.recurrenceUnit?.value || null;
        const recurrenceIntervalVal = recurrenceUnitVal && this.recurrenceInterval?.value ? Number(this.recurrenceInterval.value) : null;
        const recurrenceEndVal = recurrenceUnitVal && this.recurrenceEnd?.value ? this.recurrenceEnd.value : null;
        const projectId = this.projectSelect?.value ? Number(this.projectSelect.value) : null;

        // Determine target list from current view
        let targetList = "inbox";
        if (this.currentView.type === "list") {
            targetList = this.currentView.value;
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
            planned_date: plannedDate,
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
                this.todoInput.focus();
            }
        } catch (error) {
            this.setStatus(error.message);
        } finally {
            this.addButton.disabled = false;
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

    closeAllMenus() {
        this.todoList
            .querySelectorAll(".todo-item.menu-open")
            .forEach((item) => {
                item.classList.remove("menu-open");
            });
        this.todoList.querySelectorAll(".menu-btn").forEach((button) => {
            button.setAttribute("aria-expanded", "false");
        });
    }

    toggleMenu(item, button) {
        const shouldOpen = !item.classList.contains("menu-open");
        this.closeAllMenus();
        if (shouldOpen) {
            item.classList.add("menu-open");
            button.setAttribute("aria-expanded", "true");
        }
    }

    applyTodoUpdate(updated) {
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
        if (this.modalState) this.modalState.value = todo.state || "to_do";
        // Project tasks have list=NULL by invariant; show the empty placeholder
        // option so the modal doesn't misleadingly claim the task is in "Inbox".
        this.modalList.value = todo.project_id ? "" : (todo.list || "inbox");
        this._setModalDateField(this.modalPlannedDate, todo.planned_date || "");
        this._setModalDateField(this.modalStartDate, todo.start_date || "");
        this.modalDuration.value = todo.duration || "";
        this._setModalDateField(this.modalDeadline, todo.deadline || "");
        this.modalPriority.value = this.normalizePriority(todo.priority);
        this.modalArea.value = todo.area_id ? String(todo.area_id) : "";
        if (this.modalProject) this.modalProject.value = todo.project_id ? String(todo.project_id) : "";
        if (this.modalRecurrenceUnit) {
            this.modalRecurrenceUnit.value = todo.recurrence_unit || "";
            this.modalRecurrenceInterval.value = todo.recurrence_interval || "";
            this.modalRecurrenceEnd.value = todo.recurrence_end || "";
            this._syncModalRecurrenceVisibility();
        }
        this._syncModalFieldStates();
    }

    _syncModalFieldStates() {
        [
            { el: this.modalState,       isSet: () => true },
            { el: this.modalList,        isSet: () => true },
            { el: this.modalPlannedDate, isSet: () => !!this.modalPlannedDate.dataset.date },
            { el: this.modalStartDate,   isSet: () => !!this.modalStartDate.dataset.date },
            { el: this.modalDuration,    isSet: () => !!this.modalDuration.value && Number(this.modalDuration.value) > 0 },
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
                        (t) => !t.completed && !t.project_id && (t.list === "today" || t.planned_date === today)
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
            case "project":
                return this.todos.filter(
                    (todo) => !todo.completed && todo.project_id === view.value
                );
            default:
                return this.todos;
        }
    }

    // --- Rendering ---

    renderTodos() {
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
        } else {
            this.todoList.innerHTML = todos
                .map((todo, index) => this._renderTodoItemHtml(todo, index))
                .join("");
        }

        this.updateItemCount();
        this.updateSidebarCounts();
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
            const items = byDay.get(day) || [];
            const events = eventsByDay.get(day) || [];
            fragments.push(this._renderWeekDayHeader(day, today));
            for (const e of events) {
                fragments.push(this._renderWeekEventHtml(e));
            }
            for (const t of items) {
                fragments.push(this._renderTodoItemHtml(t, itemIndex++));
            }
            if (items.length === 0 && events.length === 0) {
                fragments.push(`<li class="week-day-empty">Geen taken</li>`);
            }
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

    _renderWeekDayHeader(dateStr, today) {
        const isToday = dateStr === today;
        const cls = isToday ? "week-day-header is-today" : "week-day-header";
        return `<li class="${cls}">${this.escapeHtml(this._weekDayLabel(dateStr, today))}</li>`;
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
                          (t) => !t.project_id && (t.list === "today" || t.planned_date === todayStr)
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
                const color = sub.color || "#0288D1";
                const errorTitle = sub.last_error
                    ? ` title="${this.escapeHtml(sub.last_error)}"`
                    : "";
                const errorBadge = sub.last_error
                    ? `<span class="calendar-sub-error" aria-label="Synchronisatiefout"${errorTitle}>!</span>`
                    : "";
                return `
                    <div class="calendar-sub-item"${errorTitle}>
                        <span class="calendar-sub-swatch" style="background:${this.escapeHtml(color)}"></span>
                        <span class="calendar-sub-name">${this.escapeHtml(sub.name)}</span>
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

    openCalendarModal() {
        if (!this.calendarModal) return;
        this.calendarNameInput.value = "";
        this.calendarUrlInput.value = "";
        this.calendarColorInput.value = "#0288D1";
        this.calendarModalError.hidden = true;
        this.calendarModalError.textContent = "";
        this.calendarModal.hidden = false;
        setTimeout(() => this.calendarNameInput.focus(), 0);
    }

    closeCalendarModal() {
        if (this.calendarModal) this.calendarModal.hidden = true;
    }

    async saveCalendarSubscription() {
        const name = (this.calendarNameInput.value || "").trim();
        const url = (this.calendarUrlInput.value || "").trim();
        const color = this.calendarColorInput.value || null;
        if (!name || !url) {
            this.calendarModalError.textContent = "Naam en URL zijn verplicht.";
            this.calendarModalError.hidden = false;
            return;
        }
        this.calendarModalSave.disabled = true;
        try {
            const data = await this.request("/api/calendar/subscriptions", {
                method: "POST",
                body: JSON.stringify({ name, url, color }),
            });
            this.closeCalendarModal();
            await this.loadCalendarSubscriptions();
            if (data.sync_error) {
                this.setStatus(`Agenda toegevoegd, maar sync gaf een fout: ${data.sync_error}`);
            } else {
                this.setStatus("Agenda toegevoegd.");
            }
            this._refreshCalendarEventsForCurrentView();
        } catch (error) {
            this.calendarModalError.textContent = error.message || "Kon agenda niet toevoegen.";
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


    async refreshTodayAgenda(force = false) {
        if (!this.todayAgendaList) return;
        const today = this.getToday();
        if (force) this.calendarEventsByRange.delete(`${today}|${today}`);
        const events = await this.loadCalendarEvents(today, today);
        const sameDay = events.filter((e) => this._eventDateKey(e) === today);
        if (this.todayAgendaTitle) {
            this.todayAgendaTitle.textContent = this._dpFormatDisplay(today);
        }
        if (sameDay.length === 0) {
            this.todayAgendaList.innerHTML = `<li class="today-agenda-empty">Geen afspraken vandaag.</li>`;
            return;
        }
        this.todayAgendaList.innerHTML = sameDay
            .map((e) => {
                const color = e.subscription_color || "#0288D1";
                return `
                    <li class="calendar-event-item today-agenda-item" style="border-left-color:${this.escapeHtml(color)}">
                        <span class="calendar-event-time">${this.escapeHtml(this._formatEventTime(e))}</span>
                        <span class="calendar-event-summary">${this.escapeHtml(e.summary || "(geen titel)")}</span>
                        ${e.location ? `<span class="calendar-event-location">${this.escapeHtml(e.location)}</span>` : ""}
                        <span class="calendar-event-source">${this.escapeHtml(e.subscription_name || "")}</span>
                    </li>
                `;
            })
            .join("");
    }

}

const app = new TodoApp();
