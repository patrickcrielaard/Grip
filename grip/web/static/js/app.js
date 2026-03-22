// Grip To-Do App - Frontend JavaScript (Supabase-backed)

class TodoApp {
    constructor() {
        this.todos = [];
        this.currentView = { type: "list", value: "inbox" };
        this.availableLists = ["inbox", "today"];
        this.availableAreas = ["personal", "work"];
        this.availablePriorities = ["not_set", "low", "medium", "high"];
        this.addTaskVisible = false;
        this.openTodoId = null;
        this.cacheElements();
        this.bindEvents();
        this.loadTodos();
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

        // Sidebar navigation
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
                } else if (item.dataset.areaFilter) {
                    this.setView({
                        type: "area",
                        value: item.dataset.areaFilter,
                    });
                }
            });
        });

        // Clear completed
        this.clearCompletedButton.addEventListener("click", () =>
            this.clearCompleted()
        );

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
                const targetArea = areaButton.dataset.area;
                this.closeAllMenus();
                this.setArea(id, targetArea || null);
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
            { el: this.modalList,     field: "list" },
            { el: this.modalDuration, field: "duration" },
            { el: this.modalPriority, field: "priority" },
            { el: this.modalArea,     field: "area" },
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
    }

    // --- Add task toggle ---

    toggleAddTask() {
        this.addTaskVisible = !this.addTaskVisible;
        this.addTaskRow.hidden = !this.addTaskVisible;
        if (this.addTaskVisible) {
            this.todoInput.focus();
        }
    }

    hideAddTask() {
        this.addTaskVisible = false;
        this.addTaskRow.hidden = true;
    }

    // --- View management ---

    setView(view) {
        this.currentView = view;

        // Update sidebar active state
        this.sidebarItems.forEach((item) => {
            let isActive = false;
            if (view.type === "list" && item.dataset.list === view.value)
                isActive = true;
            if (view.type === "view" && item.dataset.view === view.value)
                isActive = true;
            if (
                view.type === "area" &&
                item.dataset.areaFilter === view.value
            )
                isActive = true;
            item.classList.toggle("active", isActive);
            item.setAttribute("aria-pressed", isActive.toString());
        });

        // Update header title
        this.activeListLabel.textContent = this.getViewLabel();
        this.renderTodos();
    }

    getViewLabel() {
        switch (this.currentView.type) {
            case "list":
                return this.currentView.value === "inbox"
                    ? "Inbox"
                    : "Vandaag";
            case "view":
                return this.currentView.value === "all"
                    ? "Alle taken"
                    : "Voltooid";
            case "area":
                return this.getAreaLabel(this.currentView.value);
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

    normalizeArea(area) {
        if (area === null || area === undefined) {
            return null;
        }
        const normalized = area.toString().trim().toLowerCase();
        if (!normalized) {
            return null;
        }
        if (!this.availableAreas.includes(normalized)) {
            return null;
        }
        return normalized;
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
        const normalizedList =
            this.normalizeListName(todo.list) || this.availableLists[0];
        const normalizedArea = this.normalizeArea(todo.area);
        const normalizedPriority = this.normalizePriority(todo.priority);
        return {
            ...todo,
            list: normalizedList,
            area: normalizedArea,
            priority: normalizedPriority,
        };
    }

    getListLabel(listName) {
        const normalized =
            this.normalizeListName(listName) || this.availableLists[0];
        return normalized === "inbox" ? "Inbox" : "Vandaag";
    }

    getAreaLabel(area) {
        const normalized = this.normalizeArea(area);
        if (!normalized) {
            return "";
        }
        const labels = { personal: "Persoonlijk", work: "Werk" };
        return labels[normalized] || (normalized.charAt(0).toUpperCase() + normalized.slice(1));
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

    setStatus(message) {
        if (!this.statusMessage) {
            return;
        }
        this.statusMessage.textContent = message;
        if (message) {
            this.statusMessage.classList.add("visible");
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

    async addTodo() {
        const title = this.todoInput.value.trim();
        if (!title) {
            return;
        }
        const area = this.normalizeArea(this.areaSelect?.value);
        const priority = this.normalizePriority(this.prioritySelect?.value);
        const startDate = this.startDateInput?.value || null;
        const plannedDate = this.plannedDateInput?.value || null;
        const deadline = this.deadlineInput?.value || null;
        const duration = this.durationInput?.value ? Number(this.durationInput.value) : null;
        const recurrenceUnitVal = this.recurrenceUnit?.value || null;
        const recurrenceIntervalVal = recurrenceUnitVal && this.recurrenceInterval?.value ? Number(this.recurrenceInterval.value) : null;
        const recurrenceEndVal = recurrenceUnitVal && this.recurrenceEnd?.value ? this.recurrenceEnd.value : null;

        // Determine target list from current view
        let targetList = "inbox";
        if (this.currentView.type === "list") {
            targetList = this.currentView.value;
        }

        this.addButton.disabled = true;
        this.setStatus("");

        try {
            const data = await this.request("/api/todos", {
                method: "POST",
                body: JSON.stringify({
                    title,
                    list: targetList,
                    area,
                    priority,
                    start_date: startDate,
                    planned_date: plannedDate,
                    deadline,
                    duration,
                    recurrence_interval: recurrenceIntervalVal,
                    recurrence_unit: recurrenceUnitVal,
                    recurrence_end: recurrenceEndVal,
                }),
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
            const data = await this.request(`/api/todos/${id}`, {
                method: "PATCH",
                body: JSON.stringify({ list: targetList }),
            });
            if (data.todo) {
                this.applyTodoUpdate(data.todo);
                this.renderTodos();
            }
        } catch (error) {
            this.setStatus(error.message);
        }
    }

    async setArea(id, area) {
        this.setStatus("");
        try {
            const data = await this.request(`/api/todos/${id}`, {
                method: "PATCH",
                body: JSON.stringify({ area }),
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
        this.modalList.value = todo.list || "inbox";
        this._setModalDateField(this.modalPlannedDate, todo.planned_date || "");
        this._setModalDateField(this.modalStartDate, todo.start_date || "");
        this.modalDuration.value = todo.duration || "";
        this._setModalDateField(this.modalDeadline, todo.deadline || "");
        this.modalPriority.value = this.normalizePriority(todo.priority);
        this.modalArea.value = todo.area || "";
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
            { el: this.modalList,        isSet: () => true },
            { el: this.modalPlannedDate, isSet: () => !!this.modalPlannedDate.dataset.date },
            { el: this.modalStartDate,   isSet: () => !!this.modalStartDate.dataset.date },
            { el: this.modalDuration,    isSet: () => !!this.modalDuration.value && Number(this.modalDuration.value) > 0 },
            { el: this.modalDeadline,    isSet: () => !!this.modalDeadline.dataset.date },
            { el: this.modalPriority,    isSet: () => this.modalPriority.value !== "not_set" },
            { el: this.modalArea,        isSet: () => !!this.modalArea.value },
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
            payload = { list: value };
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
                        (t) => !t.completed && (t.list === "today" || t.planned_date === today)
                    );
                }
                return this.todos.filter(
                    (todo) => todo.list === view.value && !todo.completed
                );
            case "view":
                if (view.value === "all") {
                    return this.todos.filter((todo) => !todo.completed);
                }
                if (view.value === "completed") {
                    return this.todos.filter((todo) => todo.completed);
                }
                return this.todos;
            case "area":
                return this.todos.filter(
                    (todo) => todo.area === view.value && !todo.completed
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

        this.todoList.innerHTML = todos
            .map((todo, index) => {
                const checked = todo.completed ? "checked" : "";
                const completedClass = todo.completed ? "completed" : "";
                const normalizedPriority = this.normalizePriority(
                    todo.priority
                );
                const priorityClass = `priority-${normalizedPriority}`;

                const alternateList =
                    this.availableLists.find((list) => list !== todo.list) ||
                    this.availableLists[0];
                const moveLabel = `Verplaats naar ${this.getListLabel(alternateList)}`;

                const areaLabel = this.getAreaLabel(todo.area);
                const areaMarkup = areaLabel
                    ? `<span class="todo-meta-chip todo-area">${this.escapeHtml(areaLabel)}</span>`
                    : "";

                const priorityLabel =
                    this.getPriorityLabel(normalizedPriority);
                const priorityMarkup = `<span class="todo-meta-chip todo-priority ${priorityClass}">${this.escapeHtml(priorityLabel)}</span>`;

                const listLabel =
                    this.currentView.type !== "list"
                        ? `<span class="todo-meta-chip">${this.escapeHtml(this.getListLabel(todo.list))}</span>`
                        : "";

                const startDateMarkup = todo.start_date
                    ? `<span class="todo-meta-chip todo-start-date">Start: ${this.escapeHtml(todo.start_date)}</span>`
                    : "";
                const plannedDateMarkup = todo.planned_date
                    ? `<span class="todo-meta-chip todo-planned-date">Gepland: ${this.escapeHtml(todo.planned_date)}</span>`
                    : "";
                const deadlineMarkup = todo.deadline
                    ? `<span class="todo-meta-chip todo-deadline">Deadline: ${this.escapeHtml(todo.deadline)}</span>`
                    : "";
                const durationMarkup = todo.duration
                    ? `<span class="todo-meta-chip todo-duration">${this.escapeHtml(String(todo.duration))}m</span>`
                    : "";

                const recurrenceMarkup = todo.recurrence_interval && todo.recurrence_unit
                    ? `<span class="todo-meta-chip chip-recurrence" title="Herhaalt elke ${todo.recurrence_interval} ${todo.recurrence_unit}"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg></span>`
                    : "";

                const hasMeta =
                    areaLabel ||
                    normalizedPriority !== "not_set" ||
                    listLabel ||
                    todo.start_date ||
                    todo.planned_date ||
                    todo.deadline ||
                    todo.duration ||
                    todo.recurrence_interval;
                const metadataMarkup = hasMeta
                    ? `<div class="todo-meta">${listLabel}${startDateMarkup}${plannedDateMarkup}${deadlineMarkup}${durationMarkup}${areaMarkup}${priorityMarkup}${recurrenceMarkup}</div>`
                    : "";

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
                            <button class="todo-menu-item set-area-btn" data-id="${todo.id}" type="button" data-area="personal" role="menuitem">Gebied: Persoonlijk</button>
                            <button class="todo-menu-item set-area-btn" data-id="${todo.id}" type="button" data-area="work" role="menuitem">Gebied: Werk</button>
                            <button class="todo-menu-item set-area-btn" data-id="${todo.id}" type="button" data-area="" role="menuitem">Gebied wissen</button>
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
            })
            .join("");

        this.updateItemCount();
        this.updateSidebarCounts();
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
                          (t) => t.list === "today" || t.planned_date === todayStr
                      ).length
                    : activeTodos.filter((t) => t.list === list).length;
            el.textContent = count > 0 ? String(count) : "";
        });

        // View counts
        document.querySelectorAll("[data-count-view]").forEach((el) => {
            const view = el.dataset.countView;
            if (view === "all") {
                el.textContent =
                    activeTodos.length > 0 ? String(activeTodos.length) : "";
            } else if (view === "completed") {
                el.textContent =
                    completedTodos.length > 0
                        ? String(completedTodos.length)
                        : "";
            }
        });

        // Area counts
        document.querySelectorAll("[data-count-area]").forEach((el) => {
            const area = el.dataset.countArea;
            const count = activeTodos.filter((t) => t.area === area).length;
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
}

const app = new TodoApp();
