// ... (Previous JavaScript code: UTILS, THEMES, MODES, EVENTS, CHARS) ...

//////////////
//// CORE ////
//////////////

class GroupManager {
  constructor() {
    this.layerGroups = []; // Stores arrays of layer IDs: [[id1, id2], [id3, id4]]
    this.layerGroupHistory = [[]]; // History of layerGroups states for undo/redo
  }

  empty() {
    this.layerGroups = [];
    this.layerGroupHistory = [[]]; // Reset with an initial empty state
  }

  capture() {
    // Deep clone the current groups to prevent mutation of history states
    const clonedGroups = this.layerGroups.map(group => [...group]);
    if (this.layerGroupHistory.length > 50) { // Limit history size
        this.layerGroupHistory.pop();
    }
    this.layerGroupHistory.unshift(clonedGroups);
  }

  jumpHistory(cursor) {
    if (this.layerGroupHistory[cursor]) {
        // Deep clone from history to prevent mutating the history record itself
        this.layerGroups = this.layerGroupHistory[cursor].map(group => [...group]);
    } else {
        this.layerGroups = []; // Fallback to empty if history state is invalid
        console.warn("GroupManager: Invalid history cursor for groups.");
    }
  }

  findGroupsFromLayers(layers) {
    if (!layers || !layers.every(Boolean)) return []; // Ensure layers array and its contents are valid

    var foundGroups = [];
    let layerIds = layers.map(layer => layer.id);
    for (var groupLayerIds of this.layerGroups) {
      // A group is "from" these layers if all its members are in the provided layers array
      if (groupLayerIds.every(layerId => layerIds.includes(layerId))) {
        foundGroups.push([...groupLayerIds]); // Return a copy of the group
      }
    }
    return foundGroups;
  }

  ungroupLayers(layers) {
    if (!layers || !layers.every(Boolean)) return;
    const groupsContainingAnyOfLayers = this.layerGroups.filter(group =>
        group.some(id => layers.find(l => l.id === id))
    );

    // Remove groups that are fully contained within the selection of layers to ungroup.
    // Or, if a more fine-grained ungroup is needed (e.g. remove just one layer from multiple groups),
    // that logic would be more complex. Original CASCII ungroups the whole group.
    let groupsToRemoveSignatures = this.findGroupsFromLayers(layers).map(group => group.sort().toString());

    this.layerGroups = this.layerGroups.filter(group =>
        !groupsToRemoveSignatures.includes(group.sort().toString())
    );
  }

  groupLayers(layers) {
    if (!layers || layers.length < 2) return; // Need at least 2 layers to form a group
    const newGroupIds = layers.map(layer => layer.id).filter(Boolean);
    if (newGroupIds.length < 2) return;

    // Avoid adding duplicate groups or sub-groups if a larger group already exists
    const newGroupSignature = newGroupIds.slice().sort().toString();
    if (!this.layerGroups.some(g => g.slice().sort().toString() === newGroupSignature)) {
        this.layerGroups.push(newGroupIds);
    }
  }

  getSiblingLayerIds(memberLayer) {
    if (!memberLayer || !memberLayer.id) return [];
    var layerIdsInGroupsWithMember = new Set();
    for (var group of this.layerGroups) {
      if (group.includes(memberLayer.id)) {
        group.forEach(id => layerIdsInGroupsWithMember.add(id));
      }
    }
    // Return all unique layer IDs found in groups containing the memberLayer, excluding memberLayer itself if desired
    // For now, includes memberLayer itself as it's part of the group.
    return Array.from(layerIdsInGroupsWithMember);
  }

  tidy(deletedLayerIds) { // deletedLayerIds is an array of layer IDs that were removed
    if (!deletedLayerIds || deletedLayerIds.length === 0) return;
    this.layerGroups = this.layerGroups
      .map(group => group.filter(layerId => !deletedLayerIds.includes(layerId)))
      .filter(group => group.length > 1); // Remove groups that are now empty or have only one layer
  }
}

class AreaSelectManager {
  constructor() {
    this.areaSelectionPixels = []; // Stores Pixel objects
  }

  clearAreaSelection() {
    this.areaSelectionPixels.forEach(pixel => { if (pixel) pixel.renderNormal() });
    this.areaSelectionPixels = [];
  }

  areaSelectingMouseUpEvent(event) {
    // Finalize selection based on areaSelectionPixels
    // Layers fully within areaSelectionPixels are selected
    // This logic is partly in areaSelectingMouseOverEvent, mouseUp confirms.
    this.clearAreaSelection(); // Clear visual selection rectangle
    // Selected layers should already be in their selected state from mouseOver.
    // If not, one might re-apply selection here.
    // For now, just clear the visual rectangle.
    layerManager.getSelectedLayers().forEach(layer => layer.renderSelected()); // Re-render actual selected layers
  }

  areaSelectingMouseOverEvent(event) {
    if (!layerManager.getSelectPixel()) return; // Mouse must have been pressed down first

    this.clearAreaSelection(); // Clear previous visual selection rectangle
    let firstPixel = layerManager.getSelectPixel(); // Pixel where mousedown occurred

    let activePixel = canvas.getPixelById(event.target.id); // Current mouseover pixel
    if (!activePixel) return;

    let r1 = Math.min(firstPixel.row, activePixel.row);
    let r2 = Math.max(firstPixel.row, activePixel.row);
    let c1 = Math.min(firstPixel.col, activePixel.col);
    let c2 = Math.max(firstPixel.col, activePixel.col);

    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        let pixel = canvas.getPixelByRowCol(r, c);
        if (pixel) {
          this.areaSelectionPixels.push(pixel);
        }
      }
    }

    this.selectLayersInAreaSelection();
    this.areaSelectionPixels.forEach(pixel => { if(pixel) pixel.renderAreaSelected() });
  }

  selectLayersInAreaSelection() {
    let layersToSelect = [];
    const selectedPixelIds = new Set(this.areaSelectionPixels.map(p => p.id()));

    for (var layer of layerManager.layers) {
      if (layer.pixels.length === 0) { // Skip empty layers
          if (layer.isSelected()) layer.unselect(); // Unselect if it was selected but now empty
          continue;
      }
      // A layer is selected if ALL of its pixels are within the selection area
      const allLayerPixelsInSelection = layer.pixels.every(lp => lp && selectedPixelIds.has(lp.id()));

      if (allLayerPixelsInSelection) {
        layersToSelect.push(layer);
      } else {
        if (layer.isSelected() && !modeMaster.has("shift")) { // If not multi-selecting, unselect
          layer.unselect();
        }
      }
    }

    if (layersToSelect.length > 0 && !modeMaster.has("shift")) {
        // If not shift-selecting, unselect layers not in the current selection
        layerManager.layers.forEach(l => {
            if (!layersToSelect.includes(l) && l.isSelected()) {
                l.unselect();
            }
        });
    }


    if (layersToSelect.length) modeMaster.change("select", "selected"); // Change mode if anything selected
    for (let layer of layersToSelect) {
      if (!layer.isSelected()) layer.select(); // Select if not already
      // Group selection logic: if one member of a group is selected by area, select all group members
      // This might need adjustment based on desired UX for area select + groups.
      // For now, primary selection is by area, group selection is secondary.
      // layerManager.selectGroupsByMemberLayer(layer); // This could re-select layers outside area if grouped.
    }
  }
}

class LayerManager {
  LayerRegister = []; // Initialized in constructor or later

  constructor() {
    // Define LayerRegister here, after all Layer classes are defined.
    // This order dependency is a bit fragile. A better way is to have layers self-register.
    // For now, keep original structure.
    this.LayerRegister = [
        FreeLineLayer, FreeLayer, StepLineLayer, CircleLayer, SwitchLineLayer,
        SquareLayer, TextLayer, TableLayer, DiamondLayer,
    ];
    this.layers = []; // Active layers on the canvas
    this.selectedPixel = null; // The pixel object where a mousedown occurred (for dragging, resizing)
    this.layerHistory = [[]]; // For undo/redo: stores arrays of layer *data* or cloned layers
    this.historyCursor = 0;
    this.editingTextLayer = null; // Reference to TextLayer currently being edited
    this.groupManager = new GroupManager();
  }

  getLayerTypes() {
    return this.LayerRegister.map(cls => cls.type).filter(Boolean);
  }

  getLineBasedLayerTypes() {
    return this.LayerRegister.filter(cls => cls.lineBased).map(cls => cls.type).filter(Boolean);
  }

  getLayerClassByType(type) {
    for (let cls of this.LayerRegister) {
      if (type === cls.type) return cls;
    }
    console.warn(`Layer class not found for type: ${type}`);
    return null;
  }

  add(layer) {
    if (layer) this.layers.unshift(layer); // Add to the beginning (rendered last / on top initially)
  }

  addSecond(layer) { // Adds to second position, often for text layers in tables
    if (layer) this.layers.splice(1, 0, layer);
  }

  getLatestLayer() {
    return this.layers.length > 0 ? this.layers[0] : null;
  }

  hasLayer(layerId) {
    return this.layers.some(layer => layer && layer.id === layerId);
  }

  getLayerById(layerId) {
    return this.layers.find(layer => layer && layer.id === layerId) || null;
  }

  getLayerByPixelId(pixelId) { // Get topmost layer at a given pixel
    // Iterate in reverse draw order (visually topmost first)
    for (var layer of this.getLayersOrderedByZindex().reverse()) {
      if (layer && layer.hasPixel(pixelId)) return layer;
    }
    return null;
  }

  setLayers(layersArray) {
    this.layers = layersArray.filter(Boolean); // Ensure no null/undefined layers
  }

  encodeAll() {
    let encodedLayers = this.layers.map(layer => layer ? layer.encode() : null).filter(Boolean);
    let data = {
      layers: encodedLayers,
      groups: this.groupManager.layerGroups || [],
    };
    return JSON.stringify(data);
  }

  decodeLayers(encodedLayerDataArray) {
    if (!Array.isArray(encodedLayerDataArray)) return [];
    return encodedLayerDataArray.map(encodedLayer => {
        if (!encodedLayer || !encodedLayer.ty) return null;
        const LayerClass = this.getLayerClassByType(encodedLayer.ty);
        if (!LayerClass) {
            reportError(`Unknown layer type during decode: ${encodedLayer.ty}`);
            return null;
        }
        try {
            return LayerClass.decode(encodedLayer);
        } catch (e) {
            reportError(`Error decoding layer type ${encodedLayer.ty} (ID: ${encodedLayer.id || 'N/A'}): ${e.message}`);
            return null;
        }
    }).filter(Boolean); // Remove nulls from failed decodes
  }

  import(encodedData) {
    try {
        let data = JSON.parse(encodedData);
        if (!data || !Array.isArray(data.layers)) {
            reportError("Import failed: Invalid data structure. 'layers' array missing.");
            bodyComponent.informerComponent.report("Import failed: Invalid data.", "bad");
            return false;
        }
        this.refresh(() => this.empty()); // Clear current state
        const decodedLayers = this.decodeLayers(data.layers);
        this.setLayers(decodedLayers);
        this.groupManager.layerGroups = data.groups || [];

        this.redrawAll(); // Redraw newly imported layers
        this.saveToLocalStorage(); // Persist imported data
        this.capture(); // Add to history
        bodyComponent.informerComponent.report("Drawing imported successfully!", "good");
        return true;
    } catch (e) {
        reportError(`Import failed: ${e.message}`);
        bodyComponent.informerComponent.report(`Import failed: ${e.message.substring(0,100)}`, "bad");
        // Attempt to clear corrupted state if import fails badly
        this.refresh(() => this.empty());
        this.capture();
        return false;
    }
  }

  importFromLocalStorage() {
    let data = localStorage.getItem("savedDrawing");
    if (data) {
        try {
            const parsedData = JSON.parse(data);
            if (parsedData && parsedData.layers && Array.isArray(parsedData.layers) && parsedData.layers.length > 0) {
                this.import(data); // Use the main import function
            } else if (parsedData && parsedData.layers && parsedData.layers.length === 0) {
                // Empty drawing, do nothing or clear current canvas
            } else {
                console.warn("Invalid data found in localStorage for 'savedDrawing'. Clearing.");
                localStorage.removeItem("savedDrawing");
            }
        } catch (e) {
            console.error("Error parsing 'savedDrawing' from localStorage:", e);
            localStorage.removeItem("savedDrawing"); // Clear corrupted data
        }
    }
  }

  saveToLocalStorage() {
    try {
        localStorage.setItem("savedDrawing", this.encodeAll());
    } catch (e) {
        reportError(`Failed to save to local storage: ${e.message}`);
        if (bodyComponent && bodyComponent.informerComponent) {
            bodyComponent.informerComponent.report("Could not save drawing (localStorage full?).", "bad");
        }
    }
  }

  redrawAll() {
    // Ensure canvas is cleared before redrawing all layers
    if (canvas) canvas.clear(); // Clear all pixel values and visual states on the canvas itself
    
    this.refresh(() => { // refresh clears layers' internal pixel lists and then calls renderAll
      this.layers.forEach(layer => { if (layer) layer.redraw()});
      // Second pass for complex dependencies, as in original
      this.layers.forEach(layer => { if (layer) layer.redraw()});
    });
  }

  getSelectedLayers() {
    return this.layers.filter(layer => layer && layer.isSelected());
  }

  deleteSelectedLayers() {
    this.getSelectedLayers().forEach(layer => { if (layer) layer.empty()}); // Empty clears layer's pixels
    this.triggerChanged(); // Will tidy up, capture history, save
  }

  selectGroupsByMemberLayer(memberLayer) {
    if (!memberLayer) return;
    let siblingLayerIds = this.groupManager.getSiblingLayerIds(memberLayer);
    siblingLayerIds.forEach(layerId => {
        const layerToSelect = this.getLayerById(layerId);
        if (layerToSelect && !layerToSelect.isSelected()) layerToSelect.select();
    });
  }

  undo() {
    if (this.historyCursor >= this.layerHistory.length - 1 && this.layerHistory.length > 1) { // At oldest state with multiple states
        // No more undos possible, but don't increment cursor beyond array bounds
    } else if (this.layerHistory.length <= 1) { // No history or only initial state
        bodyComponent.informerComponent.report("Nothing to undo.", "default");
        return;
    } else {
       this.historyCursor++;
    }
    this.jumpHistory();
  }

  redo() {
    if (this.historyCursor <= 0) { // At newest state or no history
        bodyComponent.informerComponent.report("Nothing to redo.", "default");
        return;
    }
    this.historyCursor--;
    this.jumpHistory();
  }

  jumpHistory() {
    if (!this.layerHistory[this.historyCursor]) {
        console.warn("Attempted to jump to non-existent history state. Resetting to latest.");
        this.historyCursor = 0; // Reset to latest valid state
        if (!this.layerHistory[this.historyCursor]) { // Still no state, perhaps history is empty
            this.setLayers([]); // Set to empty state
            this.groupManager.layerGroups = [];
            this.redrawAll();
            return;
        }
    }
    // Deep clone layers from history to prevent mutation
    const historicLayers = this.layerHistory[this.historyCursor].map(layerData => {
        // Assuming history stores encoded data or requires full re-decode/re-instantiation
        // For simplicity, if it stores live Layer objects (as original copyLayersIdentically does), clone them:
        const LayerClass = this.getLayerClassByType(layerData.getType ? layerData.getType() : layerData.ty); // Check if it's already Layer object or encoded
        if (LayerClass && typeof LayerClass.prototype.copy === 'function' && layerData instanceof Layer) {
            return layerData.copy(true); // True for identical copy
        } else if (LayerClass && typeof LayerClass.decode === 'function' && layerData.ty) { // If it's encoded data
            return LayerClass.decode(layerData);
        }
        return null;
    }).filter(Boolean);

    this.setLayers(historicLayers);
    this.groupManager.jumpHistory(this.historyCursor);
    this.redrawAll(); // Redraw the state
    this.saveToLocalStorage(); // Update local storage with this state
    externalHookManager.triggerDrawingChanged();
    this.editingTextLayer = null; // Reset editing state
  }

  copyLayersIdentically(layersToCopy) {
    if (!Array.isArray(layersToCopy)) return [];
    return layersToCopy.map(layer => {
        if (layer && typeof layer.copy === 'function') {
            return layer.copy(true); // true for identical copy (same ID, etc.)
        }
        return null;
    }).filter(Boolean);
  }

  copyAndRenderSelectedLayers() {
    let layerLookup = {}; // oldId -> { old: oldLayer, new: newLayer }
    let layersToCopy = this.getSelectedLayers();
    if (layersToCopy.length === 0) return;

    this.unselectAll(); // Unselect original layers first

    for (var oldLayer of layersToCopy) {
        if (oldLayer && typeof oldLayer.copyAndRender === 'function') {
            const newLayer = oldLayer.copyAndRender(); // This adds to layerManager.layers and selects
            if (newLayer) {
                layerLookup[oldLayer.id] = { old: oldLayer, new: newLayer };
            }
        }
    }
    
    const newLayers = Object.values(layerLookup).map(entry => entry.new);
    if (newLayers.length > 0) {
        this.moveLayersToAvailableSpace(newLayers); // Try to place them without overlap
        this.repointJointsForCopiedLayers(layerLookup);
        this.regroupForCopiedLayers(layerLookup); // Group the new layers if originals were grouped
        this.repointTableTextLayers(layerLookup);
        this.triggerChanged(); // Capture new state
    }
  }

  repointTableTextLayers(layerLookup) {
    for (let oldLayerId in layerLookup) {
      let oldLayer = layerLookup[oldLayerId].old;
      let newLayer = layerLookup[oldLayerId].new;
      if (oldLayer.is("table") && newLayer.is("table")) {
        newLayer.textLayers = {}; // Clear any copied map, rebuild with new TextLayer IDs
        for (let cellId in oldLayer.textLayers) {
          let oldTextLayerId = oldLayer.textLayers[cellId];
          if (layerLookup[oldTextLayerId] && layerLookup[oldTextLayerId].new) {
            let newTextLayer = layerLookup[oldTextLayerId].new;
            newLayer.textLayers[cellId] = newTextLayer.id; // Map to new TextLayer ID
            if (newTextLayer.is("text")) {
                newTextLayer.tableId = newLayer.id; // Point new TextLayer to new TableLayer
            }
          }
        }
      }
    }
  }

  regroupForCopiedLayers(layerLookup) {
    let originalSelectedOldLayers = Object.values(layerLookup).map(entry => entry.old);
    let groupsToRecreate = this.groupManager.findGroupsFromLayers(originalSelectedOldLayers);

    for (var oldGroupMemberIds of groupsToRecreate) {
      var newGroupLayers = oldGroupMemberIds.map(oldId => {
          return (layerLookup[oldId] && layerLookup[oldId].new) ? layerLookup[oldId].new : null;
      }).filter(Boolean);

      if (newGroupLayers.length > 1) {
        this.groupManager.groupLayers(newGroupLayers);
      }
    }
    // No need to call capture here, triggerChanged at end of copyAndRenderSelectedLayers will do it.
  }

  repointJointsForCopiedLayers(layerLookup) {
    for (var oldLayerId in layerLookup) {
      let oldLayer = layerLookup[oldLayerId].old;
      let newLayer = layerLookup[oldLayerId].new;
      newLayer.joints = []; // Start with fresh joints for the new layer

      for (var oldJoint of oldLayer.joints) {
        if (layerLookup[oldJoint.layerId] && layerLookup[oldJoint.layerId].new) {
          let newJointedLayer = layerLookup[oldJoint.layerId].new;
          // Create a new joint object pointing to the new layer's ID
          newLayer.joints.push({ layerId: newJointedLayer.id, jointKey: oldJoint.jointKey });
        }
        // If the other part of the joint wasn't in the selection, the joint is not carried over.
      }
    }
  }

  getNearOverlappingCount(subjectLayer, withLayerTypes = null) {
    var count = 0;
    if (!subjectLayer) return 0;
    for (let layer of this.layers) {
      if (!layer || layer.id === subjectLayer.id) continue;
      if (withLayerTypes && Array.isArray(withLayerTypes) && !withLayerTypes.includes(layer.getType())) {
        continue;
      }
      count += layer.getNearOverlappingCount(subjectLayer); // Call method on the other layer
    }
    return count;
  }

  unselectAll() {
    this.layers.forEach(layer => { if (layer && layer.isSelected()) layer.unselect() });
    if (this.editingTextLayer) {
        this.editingTextLayer.clearLastCursor();
        this.editingTextLayer = null; // Clear reference
    }
    modeMaster.remove("selected", "multi-select"); // Ensure modes are updated
  }

  switchModeCallback() {
    if (bodyComponent) bodyComponent.hidePopups();
    this.unselectAll();
    // Do not capture history here, as mode switch often precedes an action that will capture.
    // If a mode switch itself should be a history state, then call capture.
    // Original: this.capture();
  }

  refresh(updateFunc) {
    // 1. Clear visual representation of all layers from the canvas (pixels)
    if (canvas) canvas.clear(); // Clears values from pixel components

    // 2. Clear internal pixel lists of layers (they will be repopulated by their draw methods)
    this.layers.forEach(layer => { if (layer) layer.clearInternalPixelsOnly() }); // Assumes such a method exists

    // 3. Execute the update function (e.g., move layers, create new layer)
    if (typeof updateFunc === 'function') updateFunc();

    // 4. Re-render all layers (they re-calculate their pixels and tell canvas pixels to update)
    this.renderAll();
  }


  tidyAllJoints(deletedLayerIds) {
    if (!deletedLayerIds || deletedLayerIds.length === 0) return;
    for (var layer of this.layers) {
      if (layer && Array.isArray(layer.joints)) {
        layer.joints = layer.joints.filter(joint => !deletedLayerIds.includes(joint.layerId));
        if (typeof layer.tidyJoints === 'function') layer.tidyJoints(); // Call layer's own cleanup
      }
    }
  }

  tidyLayers() {
    let layersToDeleteIds = this.layers
        .filter(layer => layer && (!layer.pixels || layer.pixels.length === 0) && !layer.is("text")) // Keep empty text layers for now
        .map(layer => layer.id);
    
    // Special handling for empty text layers not part of a table
    this.layers.forEach(layer => {
        if (layer && layer.is("text") && layer.contents.length === 0 && !layer.tableId && !layer.isSelected() && this.editingTextLayer !==layer) {
            if (!layersToDeleteIds.includes(layer.id)) layersToDeleteIds.push(layer.id);
        }
    });


    if (layersToDeleteIds.length > 0) {
        this.setLayers(this.layers.filter(layer => layer && !layersToDeleteIds.includes(layer.id)));
        this.groupManager.tidy(layersToDeleteIds);
        this.tidyAllJoints(layersToDeleteIds);
        this.tidyAllTables(layersToDeleteIds);
    }
  }

  tidyAllTables(deletedLayerIds) {
    if (!deletedLayerIds || deletedLayerIds.length === 0) return;
    for (let layer of this.layers) {
      if (layer && layer.is("table") && layer.textLayers) {
        for (let cellId in layer.textLayers) {
          if (deletedLayerIds.includes(layer.textLayers[cellId])) {
            delete layer.textLayers[cellId];
            // Optionally, archive content from table's perspective if needed
            // layer.cellTextArchive[cellId] = ... ; (if table manages this directly)
          }
        }
      }
    }
  }

  clearAll() { // Clears layer's internal pixel/value arrays and calls pixel.clear()
    this.layers.forEach(layer => { if (layer) layer.empty(); });
    if(canvas) canvas.clear(); // Ensure canvas itself is also cleared
  }

  getLayersOrderedByZindex() {
    return [...this.layers].sort((a, b) => (a ? a.zindex : 0) - (b ? b.zindex : 0));
  }

  renderAll() { // Renders layers onto canvas based on their internal state
    this.getLayersOrderedByZindex().forEach(layer => { if (layer) layer.render(); });
  }

  layerPixelIsVisible(targetLayer, targetPixel) {
    if (!targetLayer || !targetPixel || !targetPixel.id) return false;
    const targetPixelId = targetPixel.id();

    for (let layer of this.getLayersOrderedByZindex().reverse()) { // Topmost first
      if (!layer) continue;
      let isUsingPixel = layer.usesPixel(targetPixelId);
      let isTargetLayer = layer.id === targetLayer.id;

      if (isTargetLayer && isUsingPixel) return true; // Target layer is topmost at this pixel

      let isConnectedToTargetLayer = layer.hasJoinerPixel(targetPixelId) || layer.hasJointPixel(targetPixelId);
      if (!isTargetLayer && isUsingPixel && !isConnectedToTargetLayer) return false; // Another layer covers it
    }
    return false; // Should ideally be true if targetLayer uses targetPixel and wasn't covered
  }

  emptyEvent() { // Called when user wants to clear the canvas
    this.refresh(() => this.empty()); // Use refresh to ensure proper clearing and re-render of empty state
    this.triggerChanged(); // This will capture the new empty state for history
  }

  triggerChanged() {
    this.tidyLayers(); // Clean up empty layers, broken groups/joints
    this.capture();    // Capture the current state for undo/redo
    this.saveToLocalStorage(); // Persist changes
    externalHookManager.triggerDrawingChanged(); // Notify external listeners
    if (bodyComponent && bodyComponent.leftMenuComponent) { // Refresh LeftMenu for conditional buttons
        bodyComponent.leftMenuComponent.refresh();
    }
  }

  capture() {
    if (this.layerHistory.length > 50) { // Limit history stack size
        this.layerHistory.pop();
    }
    this.historyCursor = 0; // Reset cursor to the latest state
    this.layerHistory.unshift(this.copyLayersIdentically(this.layers));
    this.groupManager.capture();
  }

  setSelectPixel(pixel) {
    this.selectedPixel = pixel;
  }

  getSelectPixel() {
    return this.selectedPixel;
  }

  atomicCommit(...jobs) {
    let committedLayers = [];
    for (let [layer, func] of jobs) {
      if (!layer || typeof layer.commit !== 'function' || typeof func !== 'function') {
          console.error("Invalid job for atomicCommit:", layer, func);
          // Rollback previously committed layers in this job
          committedLayers.forEach(l => { if (l && typeof l.rollback === 'function') l.rollback(); });
          return false; // Indicate failure
      }
      let committed = layer.commit(() => func(layer));
      if (!committed) {
        committedLayers.forEach(l => l.rollback());
        return false; // Failure
      }
      committedLayers.push(layer);
    }
    return true; // Success
  }

  moveLayersAtomically(layersToMove, verticalDiff, lateralDiff) {
    if (!layersToMove || layersToMove.length === 0) return true; // Nothing to move
    let jobs = layersToMove.map(layer => [layer, (l) => l.move(verticalDiff, lateralDiff)]);
    let success = this.atomicCommit(...jobs);

    if (success) {
      layersToMove.forEach(layer => {
          if (layer && typeof layer.resizeJoinerLayers === 'function') {
            layer.resizeJoinerLayers(false); // false: don't resize selected joiners, just move them
          }
      });
    }
    return success;
  }

  moveSelectedLayers(verticalDiff, lateralDiff) {
    let selectedLayers = this.getSelectedLayers();
    if (selectedLayers.length === 0) return;

    let movedSuccessfully = false;
    // No need for full refresh here, just update layer data and re-render them
    // The commit process handles rollback if moves are not "happy"
    
    movedSuccessfully = this.moveLayersAtomically(selectedLayers, verticalDiff, lateralDiff);

    if (movedSuccessfully) {
        this.findJoints(selectedLayers); // Update joints based on new positions
        // Re-render only the moved layers and potentially affected joint pixels
        this.refresh(() => {
            // The refresh will call renderAll, which is fine.
            // Alternatively, more granular render:
            // selectedLayers.forEach(l => l.render());
            // Object.values(canvas.pixels).forEach(p => p.renderWasSelected()); // Redraw joint indicators
        });
        // triggerChanged will be called by arrow key event or mouseup, not on every mouseover move
    }
  }

  moveLayersToAvailableSpace(layers) {
    if (!layers || layers.length === 0) return false;
    const directions = [ [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1] ]; // Try cardinal then diagonal
    const MAX_OFFSET = 10; // Max distance to try moving in small steps

    for (let offset = 1; offset <= MAX_OFFSET; offset++) {
        for (let [vd, ld] of directions) {
            if (this.moveLayersAtomically(layers, vd * offset, ld * offset)) {
                return true;
            }
        }
    }
    // If still can't find space, might try a larger jump or inform user
    // For now, return false if small nudges don't work
    console.warn("Could not automatically find available space for layers.");
    return false;
  }

  findJoints(changedLayers) {
    if (!changedLayers || changedLayers.length === 0) return;
    for (var layer of this.layers) {
      if (!layer || layer.isSelected() || changedLayers.includes(layer)) continue; // Don't check against self or other changed layers in this pass

      let keyedJointPixels = layer.getKeyedJointPixels();
      for (let jointKey in keyedJointPixels) {
        let jointPixel = keyedJointPixels[jointKey];
        if (!jointPixel) continue;

        var renderState = -1; // 0: normal, 1: near, 2: jointed
        for (var probingLayer of changedLayers) {
          if (!probingLayer || probingLayer.id === layer.id) continue;
          let state = probingLayer.probeJoint(layer, jointKey, jointPixel);
          if (state > renderState) renderState = state;
        }

        // Update jointPixel's visual state
        switch (renderState) {
          case 0: jointPixel.renderWasSelected(); break; // Or renderNormal if not selected
          case 1: jointPixel.renderJointNear(); break;
          case 2: jointPixel.renderJoint(); break;
          default: jointPixel.renderNormal(); break; // Fallback
        }
      }
    }
  }

  getJoinersFromLayers(layers) {
    if (!layers || !Array.isArray(layers)) return [];
    var layerIds = new Set();
    for (var layer of layers) {
      if (layer && Array.isArray(layer.joints)) {
        for (var joint of layer.joints) {
          if (joint && joint.layerId) layerIds.add(joint.layerId);
        }
      }
    }
    return Array.from(layerIds);
  }

  prepareLayerResizing(activePixel, leadLayer) { // activePixel is the resize handle being dragged
    if (!activePixel || !leadLayer || !leadLayer.isResizable()) return false;

    let resizePixelIndexOnLead = leadLayer.getResizePixelIndex(activePixel);
    if (resizePixelIndexOnLead === -1) return false; // Not a valid resize handle on the lead layer

    for (var resizeLayer of this.getSelectedLayers()) {
      if (!resizeLayer || !resizeLayer.isResizable()) continue;

      var resizeHandleForThisLayer;
      if (resizeLayer.id === leadLayer.id) {
        resizeHandleForThisLayer = activePixel;
      } else if (resizeLayer.getType() === leadLayer.getType() && !leadLayer.isLine()) {
        const handles = resizeLayer.getResizePixels();
        resizeHandleForThisLayer = handles[resizePixelIndexOnLead];
      } else {
        resizeHandleForThisLayer = resizeLayer.getNearestResizePixel(activePixel);
      }

      if (!resizeHandleForThisLayer) continue; // Cannot determine resize handle

      resizeLayer.setToPixel(resizeHandleForThisLayer); // The 'to' pixel for resize is the handle itself
      let fromPixelForResize = resizeLayer.getResizeOppositePixel(resizeHandleForThisLayer);
      if (!fromPixelForResize) {
          console.warn(`Could not get opposite resize pixel for layer ${resizeLayer.id}`);
          continue; // Cannot proceed with resize for this layer
      }
      resizeLayer.setFromPixel(fromPixelForResize); // The 'from' is opposite to the handle
    }
    return true;
  }

  renderCharset() { // Called when charset (ASCII/Unicode) changes
    for (let layer of this.layers) {
      if (layer && typeof layer.redrawChars === 'function') {
        layer.redrawChars(layer.lineForm); // Pass current lineForm to maintain style
      }
    }
    this.triggerChanged(); // Redraw and save history
  }

  // --- Multi-layer Event Handlers ---
  resizingMouseOverEvent(event) {
    let activePixel = canvas.getPixelById(event.target.id);
    if (!activePixel || !this.getSelectPixel()) return; // Original selection pixel must exist

    let selectedLayers = this.getSelectedLayers();
    if (selectedLayers.length === 0) return;
    
    // The refresh here will clear the canvas and then call resizeLayers -> layer.draw -> pixel.setValue
    this.refresh(() => this.resizeLayers(selectedLayers, activePixel));
    this.findJoints(selectedLayers); // Recalculate joints after resize
    // Note: setSelectPixel(activePixel) is now inside resizeLayers
  }

  resizeLayers(layersToResize, currentMousePixel) {
    let originalSelectPixel = this.getSelectPixel(); // Pixel where mousedown for resize started
    if (!originalSelectPixel) return;

    // Calculate overall diff from the start of the resize drag
    let overallVerticalDiff = currentMousePixel.row - originalSelectPixel.row;
    let overallLateralDiff = currentMousePixel.col - originalSelectPixel.col;

    const joinerLayerIds = new Set(this.getJoinersFromLayers(layersToResize));

    for (var layer of layersToResize) {
      if (!layer || !layer.toPixel || !layer.fromPixel) continue; // Ensure layer has necessary anchor pixels
      if (joinerLayerIds.has(layer.id)) continue; // Joined layers are handled by their parent joint
      if (layer.hasTable()) continue; // Tables have specific resize logic (add/remove rows/cols)

      if (!layer.isResizable()) { // If not resizable, try to move it with the drag
        // This requires storing the layer's original position at drag start
        // For simplicity, if it's not resizable and part of selection, it might not move here.
        // Original logic: layer.commit(() => layer.move(overallVerticalDiff, overallLateralDiff)))
        // This might be better handled by `movingMouseOverEvent` if mode was "moving"
        continue;
      }

      // The layer.fromPixel and layer.toPixel were set by prepareLayerResizing.
      // layer.fromPixel is the fixed anchor, layer.toPixel is the handle being dragged.
      // We need to calculate the new position for layer.toPixel based on the overall mouse drag.
      let newToPixelForRow = layer.initialToPixelForResize.row + overallVerticalDiff; // Store initial state on layer?
      let newToPixelForCol = layer.initialToPixelForResize.col + overallLateralDiff;
      // For now, assume layer.toPixel at the start of resizeLayers is the handle's original spot.
      // This logic needs the *original* position of the handle pixel that was set in `setToPixel` during `prepareLayerResizing`.
      // Let's assume `layer.toPixel` holds the handle's *original* position before this drag iteration.
      // And `layer.fromPixel` holds the *opposite* corner's original position.

      // Calculate the new "active" drawing pixel for this layer based on its original handle and overall diff
      const targetDrawPixel = canvas.getPixelByRowCol(
          (layer.stashedToPixelForResize ? layer.stashedToPixelForResize.row : layer.toPixel.row) + overallVerticalDiff,
          (layer.stashedToPixelForResize ? layer.stashedToPixelForResize.col : layer.toPixel.col) + overallLateralDiff
      );

      if (!targetDrawPixel) continue; // New position is off-canvas

      // The layer's draw method will use its *current* fromPixel (set in prepareLayerResizing)
      // and this new targetDrawPixel to redraw itself.
      layer.draw(targetDrawPixel, true); // true for force redraw during resize
    }
    // DO NOT setSelectPixel(currentMousePixel) here. It should track original mousedown.
    // Instead, individual layers update their toPixel.
    // The overall diff is always from the very first selectedPixel.
  }


  movingMouseOverEvent(event) {
    let activePixel = canvas.getPixelById(event.target.id);
    if (!activePixel) return;
    let lastPixelSelected = this.getSelectPixel(); // This is previous mouse position during drag
    if (!lastPixelSelected) return;

    let verticalDiff = activePixel.row - lastPixelSelected.row;
    let lateralDiff = activePixel.col - lastPixelSelected.col;

    if (verticalDiff === 0 && lateralDiff === 0) return; // No change

    this.moveSelectedLayers(verticalDiff, lateralDiff); // This calls refresh internally
    this.setSelectPixel(activePixel); // Update for next mouseover diff calculation
  }

  selectedArrowKeyDownEvent(key) {
    var verticalDiff = 0, lateralDiff = 0;
    switch (key) {
      case "ArrowUp": verticalDiff = -1; break;
      case "ArrowRight": lateralDiff = 1; break;
      case "ArrowDown": verticalDiff = 1; break;
      case "ArrowLeft": lateralDiff = -1; break;
      default: return;
    }
    // For arrow keys, this is a discrete move, not a drag.
    // selectedPixel (from mousedown) isn't relevant here in the same way.
    let selectedLayers = this.getSelectedLayers();
    if (selectedLayers.length === 0) return;

    if (this.moveLayersAtomically(selectedLayers, verticalDiff, lateralDiff)) {
        this.refresh(() => { /* Layers already moved by moveLayersAtomically */ });
        this.findJoints(selectedLayers);
        this.triggerChanged(); // Capture history and save for arrow key moves
    }
  }

  deleteLayersEvent() { // Parameter 'event' not used
    this.refresh(() => this.deleteSelectedLayers());
    // triggerChanged is called by deleteSelectedLayers
  }

  copySelectedLayersEvent() { // Parameter 'event' not used
    this.refresh(() => this.copyAndRenderSelectedLayers());
    // triggerChanged is called by copyAndRenderSelectedLayers
  }

  changeEvent() { // Generic mouseup after drawing, moving, resizing
    this.triggerChanged();
  }

  selectMouseOverEvent(event) {
    let activePixel = canvas.getPixelById(event.target.id);
    if (!activePixel) return;

    let layerOver = this.getLayerByPixelId(activePixel.id());
    canvas.setCursor(layerOver ? "pointer" : "default");

    // Highlight resize handles of selected layers or nearby layers
    for (let layer of this.getLayersOrderedByZindex()) {
      if (!layer) continue;
      for (var resizePixel of layer.getResizePixels().filter(Boolean)) {
        if (
          (layer.isSelected() && this.layerPixelIsVisible(layer, resizePixel)) || // If layer is selected
          (!layerOver && activePixel.isNear(resizePixel, 0) && this.layerPixelIsVisible(layer, resizePixel)) // Or mouse is directly on a resize handle of a non-selected layer
        ) {
          resizePixel.renderResizable();
          if (activePixel.is(resizePixel)) canvas.setCursor("move"); // Cursor for dragging handle
        } else {
          resizePixel.renderWasSelected(); // Revert to normal or selected state
        }
      }
    }
  }

  undoEvent() { this.refresh(() => this.undo()); } // Event param not used
  redoEvent() { this.refresh(() => this.redo()); } // Event param not used

  groupSelectedLayersEvent() { // Event param not used
    const layersToGroup = this.getSelectedLayers();
    if (layersToGroup.length < 2) {
        bodyComponent.informerComponent.report("Select at least two layers to group.", "default");
        return;
    }
    this.groupManager.groupLayers(layersToGroup);
    bodyComponent.informerComponent.report("Layers grouped.", "good");
    this.triggerChanged();
  }

  ungroupSelectedLayersEvent() { // Event param not used
    const selected = this.getSelectedLayers();
    if (selected.length === 0) return;
    this.groupManager.ungroupLayers(selected);
    // After ungrouping, layers remain selected. User can then unselect or operate individually.
    bodyComponent.informerComponent.report("Selected layers ungrouped.", "good");
    this.triggerChanged();
  }

  redrawLinesEvent(direction) { // For arrowheads
    let changed = false;
    for (var layer of this.getSelectedLayers()) {
      if (layer && layer.isLine() && typeof layer.toggleArrows === 'function') {
        layer.toggleArrows(direction);
        changed = true;
      }
    }
    if (changed) this.refresh(() => {}); // Redraw changes
    // triggerChanged might be too much if just toggling visual, but good for history
    if (changed) this.triggerChanged();
  }

  redrawLineBasedEvent(lineForm) { // For line style (dotted, dashed)
    let changed = false;
    for (var layer of this.getSelectedLayers()) {
      if (layer && layer.isLineBased() && typeof layer.redrawChars === 'function') {
        layer.redrawChars(lineForm); // This method on layer should handle its redraw logic
        changed = true;
      }
    }
    if (changed) this.refresh(() => {}); // Redraw changes
    if (changed) this.triggerChanged();
  }

  selectAllEvent(event) {
    if(event) event.preventDefault();
    this.layers.forEach(layer => { if (layer) layer.select() });
    if (this.layers.length > 0) {
        modeMaster.reset("select", "selected"); // Update mode
        if (this.layers.length > 1) modeMaster.add("multi-select");
    }
  }

  erasePixelEvent(event) {
    let activePixel = canvas.getPixelById(event.target.id);
    if (!activePixel) return;
    let layer = this.getLayerByPixelId(activePixel.id());

    if (layer && !layer.is("free")) {
      bodyComponent.informerComponent.report("Can only erase free drawings or clear pixels directly.", "bad");
      return;
    }
    if (layer) { // If part of a free layer, erase from layer
      this.refresh(() => layer.erasePixel(activePixel.id())); // This will clear pixel from layer's list
      // triggerChanged will be called if in 'erasing' mode mouseup
    } else { // If not part of any layer, just clear the pixel visually (if anything was there)
      activePixel.clear();
    }
  }

  getHighestZindex() {
    if (this.layers.length === 0) return 0;
    return Math.max(0, ...this.layers.map(layer => (layer ? layer.zindex : 0)));
  }

  getLowestZindex() {
    if (this.layers.length === 0) return 0;
    return Math.min(0, ...this.layers.map(layer => (layer ? layer.zindex : 0)));
  }

  bringForwardEvent() {
    this.getSelectedLayers().forEach(layer => { if (layer) layer.zindex++; });
    this.refresh(() => this.renderAll()); // Re-render for z-index change
    this.triggerChanged();
  }
  sendBackwardsEvent() {
    this.getSelectedLayers().forEach(layer => { if (layer) layer.zindex--; });
    this.refresh(() => this.renderAll());
    this.triggerChanged();
  }
  bringToFrontEvent() {
    const highestZ = this.getHighestZindex();
    this.getSelectedLayers().forEach(layer => { if (layer) layer.zindex = highestZ + 1; });
    this.refresh(() => this.renderAll());
    this.triggerChanged();
  }
  sendToBackEvent() {
    const lowestZ = this.getLowestZindex();
    this.getSelectedLayers().forEach(layer => { if (layer) layer.zindex = lowestZ - 1; });
    this.refresh(() => this.renderAll());
    this.triggerChanged();
  }

  pasteToTextLayerEvent(event) { // When editing an existing text layer
    if (!this.editingTextLayer) return;
    if (event) { event.stopPropagation(); event.preventDefault(); } // Prevent browser paste
    let text = getClipboardText(1000); // Generous limit for paste into layer
    if (!text) return;

    this.refresh(() => {
      let committed = this.editingTextLayer.commit(() => this.editingTextLayer.paste(text));
      if (!committed) {
        bodyComponent.informerComponent.report("Paste failed: Content might leave canvas or other issue.", "bad");
      } else {
         // triggerChanged will be called by the commit success or TextLayer's own logic.
      }
    });
     if (this.editingTextLayer.isHappy()) this.triggerChanged(); // If commit was successful
  }

  pasteAsTextLayerEvent(event) { // Pasting to create a new text layer
    if (modeMaster.has("writing", "text")) return; // Already handled by pasteToTextLayerEvent if focused
    if (event) { event.stopPropagation(); event.preventDefault(); }
    
    let text = getClipboardText(5000); // Larger limit for new layer
    if (!text) return;

    modeMaster.reset("select"); // Switch out of any drawing mode
    
    // Try to paste near current mouse or center of canvas
    let targetPixel;
    if (this.selectedPixel && canvas.getPixelById(this.selectedPixel.id())) { // If a pixel was last interacted with
        targetPixel = this.selectedPixel;
    } else { // Fallback to canvas center
        targetPixel = canvas.getPixelByRowCol(roundDown(canvas.rowCount / 2), roundDown(canvas.colCount / 2));
    }
    if (!targetPixel) {
        bodyComponent.informerComponent.report("Cannot determine paste location.", "bad");
        return;
    }

    let textLayer = new TextLayer(targetPixel.id());
    textLayer.paste(text); // Use paste method to set contents
    this.add(textLayer);

    this.refresh(() => {
      if (textLayer.commit(() => textLayer.drawLayer(null, true))) { // Draw layer (force=true for initial draw)
        textLayer.select();
        modeMaster.reset("selected", "text"); // Enter selected text mode
        this.editingTextLayer = textLayer; // Set as currently edited
        // this.triggerChanged(); // Called by commit success
      } else {
        bodyComponent.informerComponent.report("Paste failed: Content may be too large or out of bounds.", "bad");
        this.layers.shift(); // Remove the uncommitted layer
      }
    });
    if (textLayer.isHappy() && this.layers.includes(textLayer)) this.triggerChanged();
  }
}
// ... JavaScript continues with Layer class definitions ...
// ... (Previous JavaScript: CORE managers) ...

///////////////////
///// LAYERS //////
///////////////////

class Layer {
  static type = "base"; // Should be overridden by subclasses
  static lineBased = false;
  static line = false;

  getType() { return this.constructor.type; }
  isLineBased() { return this.constructor.lineBased; }
  isLine() { return this.constructor.line; }
  is(layerType) { return this.getType() === layerType; }

  constructor(firstPixelId) {
    this.lineForm = "solid-thin"; // Default line form
    this.id = this.makeId();
    this.pixels = []; // Array of Pixel objects this layer occupies
    this.values = []; // Array of characters, corresponding to this.pixels
    this.joints = []; // Array of { layerId: string, jointKey: string }
    this.zindex = (layerManager ? layerManager.getHighestZindex() : 0) + 1;
    this._isSelected = false;
    this.commitLock = false; // Prevents nested stashing during a single operation
    this.stashed = {}; // For commit/rollback state
    this.tableId = null; // For layers that are part of a table (e.g., TextLayer in a cell)

    const firstPixel = canvas ? canvas.getPixelById(firstPixelId) : null;
    if (firstPixel) {
        this.setFromPixel(firstPixel);
    } else {
        // Fallback if canvas or pixel not found (should not happen in normal flow)
        this.fromPixel = { id: () => firstPixelId, row: 0, col: 0 }; // Basic mock
        if (!canvas) console.warn("Layer constructor: Canvas not available.");
        else console.warn(`Layer constructor: Invalid firstPixelId ${firstPixelId}.`);
    }
    this.setToPixel(null); // The "to" pixel, used for drawing shapes/lines

    // For resize operations, to track original state of the handle being dragged
    this.stashedToPixelForResize = null; 
  }

  clearInternalPixelsOnly() { // Used by LayerManager.refresh
    this.pixels = [];
    this.values = [];
  }


  static decode(encodedLayer) { // To be called by subclass's decode
    // Subclass should instantiate itself then call this, or this should find class
    // For now, this is more of a helper for common properties
    const LayerClass = layerManager.getLayerClassByType(encodedLayer.ty);
    if (!LayerClass) {
        reportError(`Decode Error: Unknown layer type '${encodedLayer.ty}' for ID ${encodedLayer.id}`);
        return null;
    }
    // Ensure fp (fromPixel ID) is valid, otherwise layer creation might fail.
    // If fp is null/undefined (e.g. from older data or corruption), need a fallback.
    const fromPixelId = encodedLayer.fp || (canvas ? Pixel.makeId(0,0) : 'px@0/0');

    let layer = new LayerClass(fromPixelId); // All layers need a firstPixelId
    layer.id = encodedLayer.id || layer.makeId(); // Use encoded ID or generate new if missing

    if (encodedLayer.tp) { // toPixel ID
        const toPixel = canvas.getPixelById(encodedLayer.tp);
        if (toPixel) layer.setToPixel(toPixel);
        // else: toPixel might be legitimately null for some layers or invalid
    }
    layer.zindex = encodedLayer.zi !== undefined ? encodedLayer.zi : layer.zindex;
    layer.lineForm = encodedLayer.lf || layer.lineForm;
    layer.joints = Array.isArray(encodedLayer.jts) ? encodedLayer.jts : [];
    layer.tableId = encodedLayer.tbl || null; // For table cell text layers
    return layer;
  }

  encode() {
    return {
      ty: this.getType(),
      id: this.id,
      fp: this.fromPixel ? this.fromPixel.id() : null,
      tp: this.toPixel ? this.toPixel.id() : null,
      zi: this.zindex,
      lf: this.lineForm,
      jts: this.joints,
      tbl: this.tableId || undefined, // Only include if it exists
    };
  }

  redrawChars(lineForm) { // Called when line style (dotted, etc.) or charset changes
    this.lineForm = lineForm;
    this.redraw(); // Redraw the layer with new character choices
  }

  makeId() {
    return `L${randomInt(10000, 99999)}`; // Simpler ID format
  }

  // --- Static Event Handlers (called by EventManager, 'this' is the Layer class) ---
  static drawToSelectMouseDownEvent(event, layerUnderMouse) {
    if (layerUnderMouse &&
        !layerUnderMouse.hasJointPixel(event.target.id) &&
        !layerUnderMouse.hasJoinerPixel(event.target.id)) {
      modeMaster.reset("select");
      Layer.selectMouseDownEvent(event); // Call general select logic
      return true; // Event handled by switching to select
    }
    return false;
  }

  static drawMouseDownEvent(event) { // When drawing a new layer
    let activePixel = canvas.getPixelById(event.target.id);
    if (!activePixel) return;

    let layerUnderMouse = layerManager.getLayerByPixelId(activePixel.id());
    if (Layer.drawToSelectMouseDownEvent(event, layerUnderMouse)) return;

    let layerType = modeMaster.getLayerType();
    let LayerClass = layerManager.getLayerClassByType(layerType);
    if (!LayerClass) {
      reportError(`Cannot draw: Unknown layer type "${layerType}"`);
      return;
    }

    let newLayer = new LayerClass(activePixel.id());
    layerManager.add(newLayer);
    layerManager.refresh(() => newLayer.draw(activePixel)); // Initial draw
    // No triggerChanged here; mouseup after drawing will trigger it.
  }

  static drawingMouseOverEvent(event) { // While mouse is down and moving for drawing
    let currentLayer = layerManager.getLatestLayer();
    if (!currentLayer || !modeMaster.has("drawing")) return; // Only if actively drawing

    let activePixel = canvas.getPixelById(event.target.id);
    if (!activePixel) return;

    layerManager.refresh(() => currentLayer.draw(activePixel));
    layerManager.findJoints([currentLayer]);
  }

  static drawMouseOver(event) { // Mouseover when in a "draw" mode but mouse is not down
    let activePixel = canvas.getPixelById(event.target.id);
    if (!activePixel) return;
    let layerOver = layerManager.getLayerByPixelId(activePixel.id());

    if (modeMaster.has("text") && modeMaster.has("draw")) { // Specifically for starting new text
      canvas.setCursor((!layerOver || layerOver.is("text")) ? "text" : "pointer");
    } else if (layerOver) {
      canvas.setCursor("pointer"); // Indicates something selectable/interactive is under mouse
    } else {
      canvas.setCursor("crosshair"); // Default for drawing on empty space
    }
  }

  static selectMouseDownEvent(event) {
    let activePixel = canvas.getPixelById(event.target.id);
    if (!activePixel) return;

    let layerClicked = layerManager.getLayerByPixelId(activePixel.id());
    layerManager.setSelectPixel(activePixel); // Store for potential drag operations

    const isShiftSelect = modeMaster.has("shift");
    const isCtrlSelect = modeMaster.has("ctrl"); // For selecting single item in group

    if (!layerClicked) { // Clicked on empty canvas
      if (!isShiftSelect) layerManager.unselectAll();
      modeMaster.add("area-selecting");
      areaSelectManager.areaSelectionPixels = [activePixel]; // Start area selection
      activePixel.renderAreaSelected();
      return;
    }

    // Clicked on an existing layer
    if (!isShiftSelect && (!layerClicked.isSelected() || (layerClicked.isSelected() && layerManager.getSelectedLayers().length > 1) )) {
        // If not shift-selecting, and clicked layer is not selected OR it is selected but others are too:
        // Unselect all first, then select the clicked layer.
        // Exception: If Ctrl is pressed, we might be trying to single-select within a group.
        if (!isCtrlSelect || !layerClicked.isSelected()) {
             layerManager.unselectAll();
        }
    }

    if (isShiftSelect && layerClicked.isSelected()) {
        layerClicked.unselect(); // Shift-click on already selected layer unselects it
        if(layerManager.getSelectedLayers().length === 0) modeMaster.reset("select");
    } else {
        if(!layerClicked.isSelected()) layerClicked.select(); // Select if not already selected
        modeMaster.reset("select", "selected"); // Ensure correct base modes
        if (layerManager.getSelectedLayers().length > 1) modeMaster.add("multi-select");

        modeMaster.setSelectedLayerMode(layerClicked); // Set mode based on this layer's type

        // Group selection logic:
        // If not Ctrl-clicking, or if Ctrl-clicking but the layer isn't part of a larger selected group,
        // select its group members.
        const groupMembers = layerManager.groupManager.getSiblingLayerIds(layerClicked);
        const selectedLayers = layerManager.getSelectedLayers();
        const groupIsAlreadyPartiallySelected = groupMembers.some(id => selectedLayers.find(sl => sl.id === id && sl.id !== layerClicked.id));

        if (!isCtrlSelect || (isCtrlSelect && !groupIsAlreadyPartiallySelected) ) {
            if (!layerClicked.is("table") && !layerClicked.hasTable()) { // Tables handle their own group select logic internally
                layerManager.selectGroupsByMemberLayer(layerClicked);
            }
        }
    }


    // Determine if moving or resizing
    // Store initial state of relevant pixels for layers being resized
    const selectedForResize = layerManager.getSelectedLayers();
    selectedForResize.forEach(l => {
        if (l && l.isResizable()) {
            l.stashedToPixelForResize = l.toPixel ? {row: l.toPixel.row, col: l.toPixel.col, id: () => l.toPixel.id()} : null;
             // It's crucial that fromPixel/toPixel for resize are set by prepareLayerResizing
        }
    });

    if (layerManager.prepareLayerResizing(activePixel, layerClicked)) {
      modeMaster.add("resizing");
    } else {
      modeMaster.add("moving");
    }
  }

  // --- Instance Methods ---
  draw(activePixel, forceRedraw = false) { // activePixel is the target for drawing (e.g., mouse position)
    if (!activePixel && !forceRedraw && !this.toPixel) {
        console.warn(`Layer ${this.id} draw called without target and not forcing redraw.`);
        return;
    }
    // If forcing redraw, typically use existing this.toPixel or this.fromPixel (for point-like layers)
    const targetPixel = forceRedraw ? (this.toPixel || this.fromPixel || activePixel) : activePixel;
    if (!targetPixel) {
         console.warn(`Layer ${this.id}: Target pixel for drawing is undefined.`);
         return;
    }

    let committed = this.commit(() => this.drawLayer(targetPixel, forceRedraw));
    if (committed && this.isJoinable() && typeof this.resizeJoinerLayers === 'function') {
        this.resizeJoinerLayers(true);
    }
    // releaseCommit is handled by render() or if commit fails (rollback)
  }

  isHappy() { // Base happiness condition
    const pixelsValid = this.pixels.every(p => p && typeof p.id === 'function');
    const jointPixelsValid = this.getJointPixels().every(p => p && typeof p.id === 'function');
    const fromPixelValid = this.fromPixel && typeof this.fromPixel.id === 'function';
    // toPixel can be null for some layers (e.g., TextLayer before content, or point-like layers)
    // So, only check toPixel if it's expected to be set for this layer type or operation.
    // This base check might be too strict for toPixel. Subclasses can refine.
    // For now, let's say toPixel must also be valid if it's not null.
    const toPixelValidOrNull = (this.toPixel === null) || (this.toPixel && typeof this.toPixel.id === 'function');

    return pixelsValid && jointPixelsValid && fromPixelValid && toPixelValidOrNull;
  }

  commit(...updateFuncs) {
    if (!this.isCommitting()) {
      this.stash(); // Stash current state if not already in a commit block
    }
    this.beginCommit();
    this.lastKeyedJointPixels = this.getKeyedJointPixels(); // For resizing joiners

    try {
        updateFuncs.forEach(func => func());
    } catch (e) {
        reportError(`Error during layer update function: ${e.message}`);
        this.rollback();
        return false; // Error occurred, commit failed
    }

    if (!this.isHappy()) {
      this.rollback();
      return false; // State is unhappy, commit failed
    }
    // If happy, the stashed state is now outdated. The *next* commit operation on this layer
    // will stash the new happy state if `releaseCommit` is called.
    // `releaseCommit` is typically called by `render` or on explicit rollback.
    return true; // Commit successful
  }

  isCommitting() { return this.commitLock; }
  beginCommit() { this.commitLock = true; }
  releaseCommit() { this.commitLock = false; }

  stash() {
    this.stashed = {
      fromPixel: this.fromPixel,
      toPixel: this.toPixel,
      pixels: [...this.pixels], // Shallow copy of pixel references
      values: [...this.values],
      joints: structuredClone(this.joints || []), // Deep copy
      zindex: this.zindex,
      lineForm: this.lineForm,
      _isSelected: this._isSelected,
      tableId: this.tableId,
      // Subclasses might add more to stash
    };
  }

  rollback() {
    this.fromPixel = this.stashed.fromPixel;
    this.toPixel = this.stashed.toPixel;
    this.pixels = this.stashed.pixels;
    this.values = this.stashed.values;
    this.joints = this.stashed.joints;
    this.zindex = this.stashed.zindex;
    this.lineForm = this.stashed.lineForm;
    this._isSelected = this.stashed._isSelected;
    this.tableId = this.stashed.tableId;
    // Subclasses might restore more
    this.releaseCommit();
  }

  redraw() { // Called to redraw the layer, e.g., after theme or charset change
    // Most layers will use their toPixel as the target for redraw.
    // Point-like layers or text layers might use fromPixel.
    const targetPixelForRedraw = this.toPixel || this.fromPixel;
    if (!targetPixelForRedraw) {
        // If layer is empty and has no anchors, it might not be drawable.
        // This can happen if a layer was created but never fully drawn.
        // console.warn(`Layer ${this.id} (${this.getType()}): Cannot redraw, no target pixel (toPixel or fromPixel).`);
        return;
    }
    this.drawLayer(targetPixelForRedraw, true); // true for forceRedraw
  }

  select() {
    this._isSelected = true;
    // this.renderSelected(); // Visual update handled by render() or refresh()
    if (layerManager.getSelectedLayers().length > 1) modeMaster.add("multi-select");
  }

  unselect() {
    this._isSelected = false;
    // this.renderUnselected(); // Visual update handled by render() or refresh()
    if (layerManager.getSelectedLayers().length <= 1) modeMaster.remove("multi-select");
  }

  setToPixel(pixel) { this.toPixel = pixel; }
  setFromPixel(pixel) { this.fromPixel = pixel; }

  getLastPixel() { return this.pixels.length ? this.pixels[this.pixels.length - 1] : null; }
  getMiddlePixel() { return this.pixels.length ? this.pixels[roundHalf(this.pixels.length / 2 -1)] : (this.fromPixel || null); }
  getFirstPixel() { return this.pixels.length ? this.pixels[0] : null; }

  add(pixel, value) { // Adds a pixel object and its character value to the layer
    if (!pixel || value === undefined) return;
    this.pixels.push(pixel);
    this.values.push(value);
  }

  getJointPixels() { return Object.values(this.getKeyedJointPixels()).filter(Boolean); }
  getKeyedJointPixels() { return {}; } // To be overridden: returns { key: Pixel, ... }
  getJoinerPixels() { return []; }   // To be overridden: returns [Pixel, ...]
  getResizePixels() { return []; }   // To be overridden: returns [Pixel, ...]
  getResizeOppositePixel(targetHandlePixel) { return null; } // To be overridden

  hasTable() { return Boolean(this.tableId) && (layerManager && !!layerManager.getLayerById(this.tableId)); }
  getTable() { return this.tableId ? layerManager.getLayerById(this.tableId) : null; }

  isResizable() { return this.getResizePixels().length > 0; }
  isJoinable() { return this.getJointPixels().length > 0; }
  isJoiner() { return this.getJoinerPixels().length > 0; }

  getNearestResizePixel(pixelToReference) {
    if (!pixelToReference) return null;
    const resizeHandles = this.getResizePixels().filter(Boolean);
    return pixelToReference.isNearestTo(resizeHandles);
  }
  getResizePixelIndex(targetPixel) {
    if (!targetPixel) return -1;
    return this.getResizePixels().filter(Boolean).findIndex(p => p.id() === targetPixel.id());
  }
  hasJoinerPixel(pixelId) {
    if (!pixelId) return false;
    return this.getJoinerPixels().filter(Boolean).some(p => p.id() === pixelId);
  }
  hasJointPixel(pixelId) {
    if (!pixelId) return false;
    return this.getJointPixels().filter(Boolean).some(p => p.id() === pixelId);
  }

  clear() { // Clears pixels from the canvas display
    this.pixels.forEach(pixel => { if (pixel) pixel.clear(); });
  }

  tidyJoints() { // Remove joints that are no longer valid
    let currentKeyedJoints = this.getKeyedJointPixels();
    this.joints = (this.joints || []).filter(joint => {
        const joinerLayer = layerManager.getLayerById(joint.layerId);
        if (!joinerLayer) return false; // Joiner layer gone
        const thisLayerJointPixel = currentKeyedJoints[joint.jointKey];
        if (!thisLayerJointPixel) return false; // This layer's joint point gone (e.g. table resize)
        // Check if the joinerLayer still considers thisLayerJointPixel a valid join point
        return joinerLayer.getJoinerPixels().filter(Boolean).some(p => p.id() === thisLayerJointPixel.id());
    });
  }

  copy(identical = false) { // Creates a new instance with copied properties
    if (!this.fromPixel) {
        reportError(`Cannot copy layer ${this.id}: fromPixel is undefined.`);
        return null;
    }
    const LayerClass = this.constructor; // Get the actual class of this instance
    let layerCopy = new LayerClass(this.fromPixel.id()); // All layers need a fromPixel for construction

    layerCopy.setToPixel(this.toPixel ? canvas.getPixelById(this.toPixel.id()) : null); // Re-fetch to avoid stale ref
    
    // These are shallow copies, which is usually fine for pixel references if pixels are managed globally by canvas
    layerCopy.pixels = [...this.pixels];
    layerCopy.values = [...this.values];

    layerCopy.zindex = identical ? this.zindex : this.zindex + 1; // New copies usually on top
    layerCopy.lineForm = this.lineForm;
    layerCopy.tableId = this.tableId; // Copied, will be repointed if necessary for table cell text

    if (identical) {
      layerCopy.id = this.id;
      layerCopy.joints = structuredClone(this.joints || []);
      layerCopy._isSelected = this._isSelected; // Copy selection state for history
    } else {
      // For a user-initiated copy, it gets a new ID and no initial joints or selection
      layerCopy.id = layerCopy.makeId();
      layerCopy.joints = [];
      layerCopy._isSelected = false;
    }
    return layerCopy;
  }

  copyAndRender() { // User action: copy selected layer
    let layerCopy = this.copy(false); // false for not identical (new ID, etc.)
    if (!layerCopy) return null;

    layerManager.add(layerCopy); // Add to main layer list
    this.unselect();       // Deselect original
    layerCopy.select();    // Select the new copy

    // New layer needs to be drawn fully
    layerManager.refresh(() => {
        if (layerCopy.toPixel || layerCopy.fromPixel) { // Ensure it has drawing anchors
             layerCopy.drawLayer(layerCopy.toPixel || layerCopy.fromPixel, true);
        }
    });
    return layerCopy;
  }

  getNearOverlappingCount(targetLayer) { // How many pixels of this layer are near/on targetLayer
    if (!targetLayer || targetLayer.id === this.id || this.pixels.length === 0) return 0;
    var total = 0;
    const targetPixelIds = new Set(targetLayer.pixels.map(p => p ? p.id() : null));
    const directions = [ [0,0], [1,0],[-1,0],[0,1],[0,-1], [1,1],[1,-1],[-1,1],[-1,-1] ]; // 8 directions + self

    for (let pixel of this.pixels) {
        if (!pixel) continue;
        for (let [dr, dc] of directions) {
            const nearPixel = canvas.getPixelByRowCol(pixel.row + dr, pixel.col + dc);
            if (nearPixel && targetPixelIds.has(nearPixel.id())) {
                total++;
                break; // Count this pixel once if any of its neighbors overlap
            }
        }
    }
    return total;
  }

  renderUnselected() {
    this.getJointPixels().forEach(pixel => { if(pixel) pixel.renderWasSelected() }); // Revert joint highlights
    this.pixels.forEach(pixel => { if(pixel) pixel.renderUnselected() });
  }

  renderSelected() {
    this.pixels.forEach(pixel => { if(pixel) pixel.renderSelected() });
    this.getResizePixels().filter(Boolean).forEach(pixel => { if(pixel) pixel.renderResizable() });
  }

  render() { // Called to draw/update this layer on the canvas
    this.releaseCommit(); // A render means the current state is final for this op
    this.isSelected() ? this.renderSelected() : this.renderUnselected();
    for (var i = 0; i < this.pixels.length; i++) {
      if(this.pixels[i] && this.values[i] !== undefined) {
        this.pixels[i].setValue(this.values[i]);
      }
    }
  }

  getMove(verticalDiff, lateralDiff) { // Calculate new pixel positions without applying
    return this.pixels.map(pixel => {
        if (!pixel) return null;
        return canvas.getPixelByRowCol(pixel.row + verticalDiff, pixel.col + lateralDiff);
    }).filter(Boolean); // Filter out off-canvas results
  }

  move(verticalDiff, lateralDiff) { // Applies the move
    const newPixels = this.pixels.map(p => p ? canvas.getPixelByRowCol(p.row + verticalDiff, p.col + lateralDiff) : null);
    if (newPixels.some(p => !p)) { // If any part of the move is off-canvas
        // This should make the layer "unhappy" and trigger a rollback by commit()
    }
    this.pixels = newPixels.filter(Boolean); // Update with valid pixels

    if (this.fromPixel) {
        this.fromPixel = canvas.getPixelByRowCol(this.fromPixel.row + verticalDiff, this.fromPixel.col + lateralDiff) || this.fromPixel;
    }
    if (this.toPixel) {
        this.toPixel = canvas.getPixelByRowCol(this.toPixel.row + verticalDiff, this.toPixel.col + lateralDiff) || this.toPixel;
    }
    // Subclasses (like TextLayer) might need to update other positional anchors.
  }

  resizeJoinerLayers(resizeSelectedJoinerLayers = false) {
    if (!this.lastKeyedJointPixels) {
        // This can happen if a layer is programmatically changed without a full commit cycle (e.g. direct redraw)
        // For robust resizing of joiners, lastKeyedJointPixels must be set during the commit that changes this layer.
        // console.warn(`Layer ${this.id}: lastKeyedJointPixels not available for resizeJoinerLayers.`);
        this.lastKeyedJointPixels = this.getKeyedJointPixels(); // Fallback, may not be correct if layer already changed
    }
    const currentKeyedJoints = this.getKeyedJointPixels();

    for (let joint of (this.joints || [])) {
      let joinerLayer = layerManager.getLayerById(joint.layerId);
      if (!joinerLayer || (!resizeSelectedJoinerLayers && joinerLayer.isSelected())) continue;

      let beforeJointPixelOnThisLayer = this.lastKeyedJointPixels[joint.jointKey];
      let currentJointPixelOnThisLayer = currentKeyedJoints[joint.jointKey];

      if (!currentJointPixelOnThisLayer) {
        // This layer's joint point (e.g. a table cell edge) disappeared.
        debugError(`resizeJoinerLayers: current joint pixel for key ${joint.jointKey} on layer ${this.id} not found.`);
        joinerLayer.unjoin(this.id, joint.jointKey); // Tell joiner to unjoin from this layer
        continue;
      }
      if (!beforeJointPixelOnThisLayer) {
          // Might happen if joint was just formed. Use current as "before" for this move.
          beforeJointPixelOnThisLayer = currentJointPixelOnThisLayer;
      }

      // The joinerLayer needs to redraw itself. One of its ends was at 'beforeJointPixelOnThisLayer'.
      // Now it needs to end at 'currentJointPixelOnThisLayer'.
      // We need to find which of the joinerLayer's ends was the one connected.
      let joinerEndToMove;
      let joinerFixedEnd;
      const joinerEnds = joinerLayer.getJoinerPixels ? joinerLayer.getJoinerPixels().filter(Boolean) : [];

      if (joinerEnds.length === 2) {
          if (joinerEnds[0].is(beforeJointPixelOnThisLayer)) {
              joinerEndToMove = joinerEnds[0];
              joinerFixedEnd = joinerEnds[1];
          } else if (joinerEnds[1].is(beforeJointPixelOnThisLayer)) {
              joinerEndToMove = joinerEnds[1];
              joinerFixedEnd = joinerEnds[0];
          }
      } else if (joinerEnds.length === 1 && joinerEnds[0].is(beforeJointPixelOnThisLayer)) {
          // For single-ended joiners, or if only one end was at the old joint.
          // This case is complex: where is the other end? Assume it's joinerLayer.fromPixel or toPixel.
          // This simplified model might struggle here.
          // For now, assume line-like layers with two distinct joiner pixels (ends).
      }

      if (joinerFixedEnd) {
          joinerLayer.setFromPixel(joinerFixedEnd); // Set the fixed end as 'from'
          joinerLayer.draw(currentJointPixelOnThisLayer); // Draw 'to' the new joint position
      } else {
          // If we can't determine the fixed end, the joiner might detach or behave unexpectedly.
          // A simpler approach: tell joiner to redraw with currentJointPixel as its new 'to'
          // This assumes its 'from' pixel is relatively stable or handled by its own logic.
          // joinerLayer.draw(currentJointPixelOnThisLayer); // This might not preserve the other end
          debugError(`Could not determine fixed end for joiner layer ${joinerLayer.id} during resize.`);
      }
    }
  }


  probeJoint(jointLayer, jointKeyOnParent, jointPixelOnParent) { // this = probing layer (e.g. a line)
    if (!jointLayer || !jointPixelOnParent) return 0; // Invalid parameters

    const joinerAttachmentPoints = this.getJoinerPixels().filter(Boolean); // e.g., ends of a line
    if (joinerAttachmentPoints.length === 0) return 0; // This layer cannot join

    let isVisible = layerManager.layerPixelIsVisible(jointLayer, jointPixelOnParent);
    var bestState = 0; // 0: no connection, 1: near, 2: connected
    let madeAJointThisProbe = false;

    for (var probePixel of joinerAttachmentPoints) { // For each end of this line
      if (isVisible && probePixel.isNear(jointPixelOnParent)) {
        bestState = Math.max(bestState, 1); // At least near
        if (probePixel.is(jointPixelOnParent)) { // Direct hit!
          jointLayer.join(this.id, jointKeyOnParent); // Tell the jointLayer (parent) about this join
          this.join(jointLayer.id, probePixel.id() === joinerAttachmentPoints[0].id() ? "start" : "end"); // Line itself records it's connected
          madeAJointThisProbe = true;
          bestState = 2;
          break; // One end of this line has successfully joined.
        }
      }
    }

    if (!madeAJointThisProbe && bestState < 2) {
        // If it was previously joined to this specific jointLayer+jointKey, but no longer meets criteria, unjoin.
        const existingJointOnParent = jointLayer.joints.find(j => j.layerId === this.id && j.jointKey === jointKeyOnParent);
        if (existingJointOnParent) {
            jointLayer.unjoin(this.id, jointKeyOnParent);
        }
        // Also, if this line thought it was joined to jointLayer, it should unjoin.
        // This requires more specific tracking on the line layer's side for its own joints.
        // For now, parent layer (jointLayer) manages the canonical joint list.
    }
    return bestState;
  }


  join(otherLayerId, myAttachmentKey) { // Call when this layer successfully joins to another
    // This layer (e.g. a line) can also store its own joint info if needed for its logic
    // Example: this.myOwnJoints.push({ attachedToLayerId: otherLayerId, myKey: myAttachmentKey });
    // This is distinct from the jointLayer's `joints` array.
    // For now, CASCII primarily uses the jointLayer's `joints` array.
  }

  unjoin(otherLayerId, myAttachmentKey) {
    // If this layer was storing its own joint info
    // Example: this.myOwnJoints = this.myOwnJoints.filter(j => !(j.attachedToLayerId === otherLayerId && j.myKey === myAttachmentKey));
  }

  hasPixel(pixelId) {
    if (!pixelId) return false;
    return this.pixels.some(p => p && p.id() === pixelId);
  }
  usesPixel(pixelId) { // If this layer either owns the pixel or uses it as a joint display point
    if (!pixelId) return false;
    return this.hasPixel(pixelId) || this.hasJointPixel(pixelId);
  }
  getPixelIndex(pixelId) {
    if (!pixelId) return -1;
    return this.pixels.findIndex(p => p && p.id() === pixelId);
  }

  erasePixel(pixelId) { // For FreeLayer primarily
    const index = this.getPixelIndex(pixelId);
    if (index > -1) {
      if (this.pixels[index]) this.pixels[index].clear(); // Clear from canvas display
      this.pixels.splice(index, 1);
      this.values.splice(index, 1);
    }
  }

  deletePixelByPosition(index) { // More generic removal
    if (index >= 0 && index < this.pixels.length) {
      if (this.pixels[index]) this.pixels[index].clear();
      this.pixels.splice(index, 1);
      this.values.splice(index, 1);
    }
  }

  isSelected() { return this._isSelected; }

  empty() { // Clears all pixels OF THIS LAYER from canvas and internal arrays
    this.clear(); // Calls pixel.clear() for each pixel in this.pixels
    this.pixels = [];
    this.values = [];
    // Note: Does not automatically clear joints. TidyLayers handles that.
    // If a layer becoming empty should always break its joints, add logic here or ensure tidy is called.
  }

  getMinMaxRowsCols() { // Get bounding box of the layer's current pixels
    if (this.pixels.length === 0) return [-1, -1, -1, -1]; // MaxCol, MinCol, MaxRow, MinRow
    let minR = this.pixels[0].row, maxR = this.pixels[0].row;
    let minC = this.pixels[0].col, maxC = this.pixels[0].col;
    for (let pixel of this.pixels) {
      if (!pixel) continue;
      minR = Math.min(minR, pixel.row); maxR = Math.max(maxR, pixel.row);
      minC = Math.min(minC, pixel.col); maxC = Math.max(maxC, pixel.col);
    }
    return [maxC, minC, maxR, minR];
  }
}

// ... TextLayer and other specific layer classes will follow ...
// ... (Previous JavaScript: Layer base class) ...

class TextLayer extends Layer {
  static type = "text";
  starterChar = ">"; // Character shown for new, empty text layers

  constructor(firstPixelId, tableId = null) {
    super(firstPixelId);
    this.contents = []; // Array of single characters, including '\n'
    this.cursor = 0;    // Index in this.contents where the next char will be inserted
    this.tableId = tableId; // ID of TableLayer if this text is in a cell
    this.lastCursorPixel = null; // The Pixel object where the cursor was last rendered

    if (this.tableId) {
        const table = this.getTable();
        if (table) this.zindex = table.zindex; // Match parent table's z-index
    }
    // TextLayers are point-based initially; toPixel isn't used for their shape.
    // Set toPixel to fromPixel to satisfy Layer.isHappy() if it checks toPixel.
    if (this.fromPixel) this.setToPixel(this.fromPixel);
    this.noWrites = false; // Flag if only starterChar is present
  }

  static decode(encodedLayer) {
    let layer = Layer.decode(encodedLayer); // Call base class decode
    if (!layer) return null;
    layer.contents = encodedLayer.cts ? encodedLayer.cts.split("") : [];
    // cursor position is transient, typically reset on load or interaction
    layer.cursor = 0; // Or Math.min(encodedLayer.cur || 0, layer.contents.length);
    // tableId already handled by Layer.decode if tbl property exists
    return layer;
  }

  encode() {
    let encoded = super.encode();
    encoded.cts = this.contents.join("");
    // encoded.cur = this.cursor; // Optional: store cursor position
    return encoded;
  }

  // --- Static Event Handlers for TextLayer ---
  static selectedDoubleClickEvent(event) { // Double click on a selected TextLayer
    let activePixel = canvas.getPixelById(event.target.id);
    if (!activePixel) return;
    let layer = layerManager.getLayerByPixelId(activePixel.id());
    if (layer && layer.is("text")) {
      modeMaster.change("selected", "writing"); // Switch from selected to writing mode
      layerManager.editingTextLayer = layer;
      layer.moveCursorToPixel(activePixel); // Position cursor at dbl-clicked char
    }
  }

  static drawMouseDownEvent(event) { // Starting a new TextLayer
    let activePixel = canvas.getPixelById(event.target.id);
    if (!activePixel) return;

    if (TextLayer.focusedOtherTextLayer(activePixel)) return; // Clicked on existing text

    let layerUnderMouse = layerManager.getLayerByPixelId(activePixel.id());
    if (Layer.drawToSelectMouseDownEvent(event, layerUnderMouse)) return; // Clicked another layer type

    // Create new text layer
    let newTextLayer = new TextLayer(activePixel.id());
    layerManager.add(newTextLayer);
    layerManager.editingTextLayer = newTextLayer;
    newTextLayer.setStarterChar(); // Add initial ">"
    newTextLayer.noWrites = true;

    layerManager.refresh(() => newTextLayer.drawLayer(null, true)); // Draw with starter char
    if (newTextLayer.pixels.length > 0) { // Cursor at the end of starter char
        newTextLayer.cursor = newTextLayer.contents.length;
        newTextLayer.moveCursorToPixel(newTextLayer.pixels[newTextLayer.pixels.length-1] || newTextLayer.fromPixel);
    } else { // No pixels drawn (e.g. out of bounds), fallback
        newTextLayer.moveCursorToPixel(newTextLayer.fromPixel);
    }
    // No triggerChanged; mouseup or keypress will handle it.
  }

  static writingMouseDownEvent(event) { // Click while in "writing" mode
    let activePixel = canvas.getPixelById(event.target.id);
    if (!activePixel) return;

    if (!TextLayer.focusedOtherTextLayer(activePixel)) { // Clicked outside any text layer
      if (layerManager.editingTextLayer) {
          layerManager.editingTextLayer.clearLastCursor();
          // If text layer is empty and not part of table, it might be tidied up
          if (layerManager.editingTextLayer.contents.join("") === layerManager.editingTextLayer.starterChar && !layerManager.editingTextLayer.tableId) {
              // This could be a candidate for deletion if user clicks away
          }
          layerManager.editingTextLayer = null;
      }
      modeMaster.reset("select"); // Exit writing mode, back to select
      layerManager.unselectAll();
      layerManager.triggerChanged(); // Tidy up potentially empty text layer
    }
    // If focusedOtherTextLayer is true, it handles cursor and editingTextLayer update.
  }

  static keyDownEvent(event) { // Handles keyboard input for the active text layer
    let currentTextLayer = layerManager.editingTextLayer;
    if (!currentTextLayer || !currentTextLayer.is("text")) return;

    // Prevent browser shortcuts like Ctrl+B for bold if we don't handle them
    if (event.ctrlKey && !["a","c","v","x","z","y"].includes(event.key.toLowerCase())) { // Allow common edit shortcuts
        // event.preventDefault(); // Be careful with this, can block useful browser functions
    }

    currentTextLayer.draw(event.key); // 'draw' for TextLayer means process key
    // layerManager.refresh is not needed here, drawLayer handles pixel updates.
    // triggerChanged will be called by TextLayer.draw() if content changes.
  }

  static focusedOtherTextLayer(activePixel) { // Helper: focus another text layer or current
    let layerUnderMouse = layerManager.getLayerByPixelId(activePixel.id());

    if (layerManager.editingTextLayer && (!layerUnderMouse || layerManager.editingTextLayer.id !== layerUnderMouse.id)) {
        // If there was an active text layer and we're clicking elsewhere (or on different text)
        layerManager.editingTextLayer.clearLastCursor();
        if (layerManager.editingTextLayer.noWrites && !layerManager.editingTextLayer.tableId) { // If only starter char and not in table
             // layerManager.layers = layerManager.layers.filter(l => l.id !== layerManager.editingTextLayer.id); // Remove it
        }
    }

    if (layerUnderMouse && layerUnderMouse.is("text")) {
      if (layerManager.editingTextLayer !== layerUnderMouse) {
          layerManager.editingTextLayer = layerUnderMouse; // Switch active text layer
          modeMaster.reset("writing", "text"); // Ensure correct modes
      }
      layerUnderMouse.moveCursorToPixel(activePixel);
      return true; // Focused a text layer
    }
    // If clicked on non-text or empty space, and there was an editing layer, it's cleared above.
    // If no editing layer, and clicked non-text, then nothing text-related to do.
    return false;
  }

  // --- Instance Methods for TextLayer ---
  isHappy() {
    if (this.hasTable()) {
      const table = this.getTable();
      return table ? table.isHappy() && super.isHappy() : super.isHappy();
    }
    // Text layer is happy even if its content makes it go out of bounds initially during typing.
    // The commit() on individual key presses will handle rollbacks if a char makes it truly invalid.
    // Super.isHappy() checks fromPixel primarily.
    return super.isHappy();
  }

  clearLastCursor() {
    if (this.lastCursorPixel) {
      this.lastCursorPixel.stopCursor();
      this.lastCursorPixel = null;
    }
  }

  copy(identical = false) {
    let layerCopy = super.copy(identical); // Call Layer.copy
    if (!layerCopy) return null;
    layerCopy.contents = [...this.contents];
    layerCopy.starterChar = this.starterChar;
    // Cursor, lastCursorPixel, noWrites are transient states, generally not copied unless for exact history snapshot.
    if (identical) {
        layerCopy.cursor = this.cursor;
        layerCopy.noWrites = this.noWrites;
    }
    return layerCopy;
  }

  stash() {
    super.stash();
    this.stashed.contents = [...this.contents];
    this.stashed.cursor = this.cursor;
    this.stashed.noWrites = this.noWrites;
    // lastCursorPixel is not stashed as it's a DOM element reference.
  }

  rollback() {
    const oldLastCursorPixel = this.lastCursorPixel; // Store before super.rollback might clear it
    super.rollback();
    this.contents = this.stashed.contents !== undefined ? this.stashed.contents : [];
    this.cursor = this.stashed.cursor !== undefined ? this.stashed.cursor : 0;
    this.noWrites = this.stashed.noWrites !== undefined ? this.stashed.noWrites : (this.contents.join("") === this.starterChar);

    // After rollback, redraw to reflect stashed state, this will also try to place cursor.
    this.drawLayer(null, true); // Force redraw based on rolled-back content
    // Try to restore cursor based on new content and old cursor pixel if still relevant
    if (oldLastCursorPixel && this.pixels.some(p => p.is(oldLastCursorPixel))) {
        this.moveCursorToPixel(oldLastCursorPixel);
    } else if (this.pixels.length > 0) {
        // Try to place cursor based on rolled-back this.cursor
        this.placeCursorAtLogicalPosition();
    } else if (this.fromPixel) {
        this.moveCursorToPixel(this.fromPixel); // Fallback
    }
  }


  getKeyedJointPixels() {
    if (this.hasTable() || this.pixels.length === 0) return {};
    let firstActualPixel = this.getFirstPixel(); // Actual first rendered pixel
    if (!firstActualPixel) return {};

    if (this.pixels.length < 2) { // Single character or point
      return { l: firstActualPixel, r: firstActualPixel, t: firstActualPixel, b: firstActualPixel };
    }
    let [maxC, minC, maxR, minR] = this.getMinMaxRowsCols();
    if (minC === -1) return {}; // Should not happen if pixels.length >= 2

    let halfwayRow = minR + roundHalf((maxR - minR) / 2);
    let halfwayCol = minC + roundHalf((maxC - minC) / 2);
    return {
      l: canvas.getPixelByRowCol(halfwayRow, minC - 1),
      r: canvas.getPixelByRowCol(halfwayRow, maxC + 1),
      t: canvas.getPixelByRowCol(minR - 1, halfwayCol),
      b: canvas.getPixelByRowCol(maxR + 1, halfwayCol),
    };
  }

  getLength() { return this.contents.length; }

  placeCursorAtLogicalPosition() { // Based on this.cursor index
    this.clearLastCursor();
    if (this.contents.length === 0 && this.cursor === 0) { // Empty text, cursor at start
        if (this.fromPixel) this.fromPixel.startCursor();
        this.lastCursorPixel = this.fromPixel;
        return;
    }

    let r = this.fromPixel.row;
    let c = this.fromPixel.col;
    let targetPixel = null;

    for (let i = 0; i < this.cursor; i++) {
        if (i >= this.contents.length) break; // Cursor is beyond content
        if (this.contents[i] === '\n') {
            r++;
            c = this.fromPixel.col;
        } else {
            c++;
        }
    }
    // Cursor is *after* the character at `this.cursor - 1`, or at start of line if `this.cursor` points to '\n'
    // or at fromPixel if cursor is 0.
    if (this.cursor === 0) {
        targetPixel = this.fromPixel;
    } else {
        // If cursor is after a newline, it's at col 0 of next line.
        // Otherwise, it's after the char at contents[this.cursor-1].
        // Need to find the pixel *at* the cursor position (for cursor *before* char)
        // or *after* the char for cursor *after* char.
        // The loop above calculates (r,c) for char *at* cursor index.
        targetPixel = canvas.getPixelByRowCol(r, c);
    }


    if (!targetPixel && this.pixels.length > 0) { // Fallback if calculated is off-canvas
        targetPixel = this.pixels[Math.min(this.cursor, this.pixels.length -1)] || this.fromPixel;
    } else if (!targetPixel) {
        targetPixel = this.fromPixel;
    }

    if (targetPixel) {
        targetPixel.startCursor();
        this.lastCursorPixel = targetPixel;
    }
  }


  moveCursorToPixel(pixelToMoveTo) { // pixelToMoveTo is a Pixel object
    if (!pixelToMoveTo || !this.fromPixel) return;
    this.clearLastCursor();

    let relativeRow = pixelToMoveTo.row - this.fromPixel.row;
    let relativeCol = pixelToMoveTo.col - this.fromPixel.col;
    let currentLine = 0;
    let currentCol = 0;
    let newCursorPos = 0;
    let foundExact = false;

    for (let i = 0; i < this.contents.length; i++) {
      if (currentLine === relativeRow && currentCol === relativeCol) {
        newCursorPos = i; // Cursor before this character
        foundExact = true;
        break;
      }
      if (this.contents[i] === '\n') {
        currentLine++;
        currentCol = 0;
        if (currentLine > relativeRow) { // Passed the target row
            newCursorPos = i; // Place at end of previous line (before \n)
            break;
        }
      } else {
        currentCol++;
      }
      newCursorPos = i + 1; // Default to end if loop finishes
    }
    // If clicked past all content on a line
    if (!foundExact && currentLine === relativeRow && relativeCol >= currentCol) {
        newCursorPos = this.contents.length; // End of text or end of current line before a newline
        for(let k=0; k<this.contents.length; ++k) {
            if (this.getLineForCharIndex(k) === currentLine) newCursorPos = k+1; else if (this.getLineForCharIndex(k) > currentLine) break;
        }
        if (relativeRow < this.getLineForCharIndex(this.contents.length-1)) { // if not last line
            // find end of current line
        } else {
            newCursorPos = this.contents.length;
        }
    }


    this.cursor = Math.min(newCursorPos, this.contents.length);
    if (pixelToMoveTo) pixelToMoveTo.startCursor();
    this.lastCursorPixel = pixelToMoveTo;
  }


  getCursorLineOffset() { // Characters from start of current line to cursor
    let currentLineStart = 0;
    for (let i = this.cursor - 1; i >= 0; i--) {
      if (this.contents[i] === '\n') {
        currentLineStart = i + 1;
        break;
      }
    }
    return this.cursor - currentLineStart;
  }

  getCurrentLine() { // Line index (0-based)
    let line = 0;
    for (let i = 0; i < this.cursor; i++) {
      if (this.contents[i] === '\n') line++;
    }
    return line;
  }

  getLineStart(targetLineIndex) { // Index in contents[] of first char of targetLineIndex
    if (targetLineIndex === 0) return 0;
    let line = 0;
    for (let i = 0; i < this.contents.length; i++) {
      if (this.contents[i] === '\n') {
        line++;
        if (line === targetLineIndex) return i + 1;
      }
    }
    return this.contents.length; // If line not found (e.g., asking for line past end)
  }

  getLineLengths() { // Array of lengths for each line
    let lengths = [0];
    for (let char of this.contents) {
      if (char === '\n') {
        lengths.push(0);
      } else {
        lengths[lengths.length - 1]++;
      }
    }
    return lengths;
  }

  getVerticalCursor(direction) { // Calculate new cursor index for ArrowUp/Down
    let currentLineIdx = this.getCurrentLine();
    let charOffsetInCurrentLine = this.getCursorLineOffset();
    let lineLens = this.getLineLengths();
    let targetLineIdx;

    if (direction === "up") {
      targetLineIdx = Math.max(0, currentLineIdx - 1);
    } else { // "down"
      targetLineIdx = Math.min(lineLens.length - 1, currentLineIdx + 1);
    }

    let targetLineStartIdx = this.getLineStart(targetLineIdx);
    let targetLineLen = lineLens[targetLineIdx] || 0;
    return targetLineStartIdx + Math.min(charOffsetInCurrentLine, targetLineLen);
  }

  draw(keyOrText) { // Handles a single key press or pasted text string
    let contentChanged = false;
    let originalCursor = this.cursor;
    let originalContents = [...this.contents];

    if (keyOrText.length === 1) { // Single key press
        this.writeChar(keyOrText); // Updates this.contents and this.cursor
        contentChanged = true; // Assume key press always changes something or cursor
    } else { // Pasted text
        this.paste(keyOrText); // Updates this.contents and this.cursor
        contentChanged = true;
    }

    // Commit will call drawLayer. If commit fails, it rolls back contents and cursor.
    let committed = this.commit(
        () => { /* Content already changed by writeChar/paste */ },
        () => this.drawLayer(null, true) // Force redraw based on new content
    );

    if (committed) {
      if (this.noWrites && this.contents.length > 0 && this.contents.join("") !== this.starterChar) {
          this.noWrites = false; // User has typed something other than starter
      }
      this.updateParentTable();
      this.resizeJoinerLayers(true);
      layerManager.triggerChanged(); // After successful text change
    } else {
        // Rollback handled by commit. Inform user if necessary.
        // console.warn("Text change not committed.");
    }
  }

  updateParentTable() {
    if (this.hasTable()) {
      const table = this.getTable();
      if (table && typeof table.drawRefreshSpacing === 'function') {
        table.drawRefreshSpacing(this.id);
      }
    }
  }

  writeChar(key) { // Process single key press
    let len = this.contents.length;
    this.cursor = Math.max(0, Math.min(this.cursor, len)); // Clamp cursor

    switch (key) {
      case "ArrowDown": this.cursor = this.getVerticalCursor("down"); break;
      case "ArrowUp": this.cursor = this.getVerticalCursor("up"); break;
      case "ArrowRight": this.cursor = Math.min(len, this.cursor + 1); break;
      case "ArrowLeft": this.cursor = Math.max(0, this.cursor - 1); break;
      case "Enter":
        this.contents.splice(this.cursor, 0, "\n");
        this.cursor++;
        break;
      case "Backspace":
        if (this.cursor > 0) {
          this.contents.splice(this.cursor - 1, 1);
          this.cursor--;
        }
        break;
      case "Delete":
        if (this.cursor < len) {
          this.contents.splice(this.cursor, 1);
          // Cursor doesn't move with Delete
        }
        break;
      default: // Regular character
        if (key && key.length === 1) { // Ensure it's a single char (not "Shift", "Control")
          this.contents.splice(this.cursor, 0, key);
          this.cursor++;
        }
        break;
    }
    this.checkNoWrites();
  }

  drawLayer(_, forceRedraw = false) { // activePixel often null, forceRedraw indicates explicit call
    this.clearLastCursor();
    this.clear(); // Clear existing Layer.pixels and their display on canvas

    if (!this.fromPixel) {
      reportError(`TextLayer ${this.id}: fromPixel is not defined. Cannot draw.`);
      return;
    }

    let currentR = this.fromPixel.row;
    let currentC = this.fromPixel.col;
    let cursorPixelSet = false;

    for (let i = 0; i < this.contents.length; i++) {
      // Check for cursor position *before* processing character i
      if (!forceRedraw && this.cursor === i && !cursorPixelSet) {
        const cursorP = canvas.getPixelByRowCol(currentR, currentC);
        if (cursorP) {
            cursorP.startCursor();
            this.lastCursorPixel = cursorP;
            cursorPixelSet = true;
        }
      }

      let char = this.contents[i];
      if (char === '\n') {
        currentR++;
        currentC = this.fromPixel.col;
        continue; // Don't draw newline char
      }

      let pixelForChar = canvas.getPixelByRowCol(currentR, currentC);
      if (!pixelForChar) { // Out of bounds
        // Text goes off canvas. Layer might become "unhappy" if strict.
        // For typing, we often allow it and expect commit/rollback to handle if it's truly invalid.
        // console.warn(`TextLayer ${this.id} content out of bounds at ${currentR},${currentC}`);
        this.contents = this.contents.slice(0, i); // Truncate
        break;
      }
      this.add(pixelForChar, char); // Add to this.pixels and this.values
      pixelForChar.setValue(char); // Immediately update canvas pixel display
      currentC++;
    }

    // If cursor is at the very end of the text
    if (!forceRedraw && this.cursor === this.contents.length && !cursorPixelSet) {
        const cursorP = canvas.getPixelByRowCol(currentR, currentC); // Position for next char
        if (cursorP) {
            cursorP.startCursor();
            this.lastCursorPixel = cursorP;
        } else { // If end position is off-canvas, try last valid pixel
            const lastGoodPixel = this.getLastPixel() || this.fromPixel;
            if (lastGoodPixel) {
                lastGoodPixel.startCursor(); // May look a bit off if truly off-canvas
                this.lastCursorPixel = lastGoodPixel;
            }
        }
    }
    // If forceRedraw, cursor is not rendered by this method.
  }


  checkNoWrites() { // Manages the ">" starter character state
    if (this.noWrites && this.contents.join("") !== this.starterChar) {
        this.noWrites = false;
    }
    if (this.contents.length === 0 && !this.tableId) { // Only add starter if not in table and truly empty
        this.setStarterChar();
        this.noWrites = true;
    }
  }

  setStarterChar() {
    if (this.contents.length === 0 && !this.tableId) { // Avoid adding starter to table cells automatically
      this.contents = [this.starterChar];
      this.cursor = 1; // Cursor after starter char
      this.noWrites = true;
    }
  }

  paste(textToPaste) {
    if (!textToPaste) return;
    const chars = textToPaste.split("").filter(char => char !== '\r'); // Remove CR
    this.contents.splice(this.cursor, 0, ...chars);
    this.cursor += chars.length;
    this.checkNoWrites();
    // drawLayer will be called by the commit process initiated by TextLayer.draw()
  }
}
// ... BaseLineLayer and other specific layer classes will follow ...
// ... (Previous JavaScript: TextLayer class) ...

class BaseLineLayer extends Layer {
  static lineBased = true; // Indicates it uses line characters
  static line = true;      // Indicates it's a "line" type for mode purposes

  constructor(firstPixelId) {
    super(firstPixelId);
    this.hasArrowLeft = false;  // Arrow at the 'fromPixel' end of the line logic
    this.hasArrowRight = false; // Arrow at the 'toPixel' end of the line logic
  }

  static decode(encodedLayer) {
    let layer = Layer.decode(encodedLayer); // Call base Layer.decode
    if (!layer) return null;
    layer.hasArrowLeft = !!encodedLayer.al; // Ensure boolean
    layer.hasArrowRight = !!encodedLayer.ar; // Ensure boolean
    return layer;
  }

  encode() {
    let encoded = super.encode();
    encoded.al = this.hasArrowLeft;
    encoded.ar = this.hasArrowRight;
    return encoded;
  }

  static drawMouseOver(event) { // When in "draw" + "line" mode, mouse not down
    Layer.drawMouseOver(event); // Call base for general cursor (crosshair/pointer)
    let activePixel = canvas.getPixelById(event.target.id);
    if (!activePixel) return;

    // Highlight nearby joint pixels on other layers
    for (var otherLayer of layerManager.layers) {
      if (!otherLayer || otherLayer.id === (layerManager.getLatestLayer() && layerManager.getLatestLayer().id)) continue; // Skip self if drawing

      for (var jointPixel of otherLayer.getJointPixels().filter(Boolean)) {
        if (activePixel.isNear(jointPixel, 1) && layerManager.layerPixelIsVisible(otherLayer, jointPixel)) { // Nearness 1 for lines
          jointPixel.renderJointNear();
          if (activePixel.is(jointPixel)) { // Directly on a joint pixel
            // Keep crosshair if no text mode, or specific cursor
            canvas.setCursor(modeMaster.has("text") ? "text" : "crosshair");
          }
        } else {
          jointPixel.renderWasSelected(); // Revert to normal/selected state
        }
      }
    }
  }

  copy(identical = false) {
    let layerCopy = super.copy(identical);
    if (!layerCopy) return null;
    layerCopy.hasArrowLeft = this.hasArrowLeft;
    layerCopy.hasArrowRight = this.hasArrowRight;
    return layerCopy;
  }

  toggleArrows(direction) { // 'left' for fromPixel end, 'right' for toPixel end
    if (direction === "left") this.hasArrowLeft = !this.hasArrowLeft;
    if (direction === "right") this.hasArrowRight = !this.hasArrowRight;
    this.redraw(); // Redraw to show/hide arrow
  }

  getEndPixels() { // Returns the fromPixel and toPixel if they exist
    const from = this.fromPixel ? canvas.getPixelById(this.fromPixel.id()) : null;
    const to = this.toPixel ? canvas.getPixelById(this.toPixel.id()) : null;
    // These are the logical start/end, not necessarily the first/last in this.pixels array
    // especially for complex lines. For simple lines, they often match.
    if (from && to) return [from, to];
    // Fallback to actual rendered pixels if logical ends are not robustly set
    // const firstDrawn = this.getFirstPixel();
    // const lastDrawn = this.getLastPixel();
    // if (firstDrawn && lastDrawn) return [firstDrawn, lastDrawn];
    return [];
  }

  getResizePixels() { // Lines are typically resized from their ends
    return this.getEndPixels();
  }

  getJoinerPixels() { // Lines can join to other layers at their ends
    return this.getEndPixels();
  }

  getResizeOppositePixel(handlePixel) { // Given one end (handlePixel), return the other
    if (!handlePixel) return null;
    const ends = this.getEndPixels();
    if (ends.length < 2) return null;
    if (handlePixel.is(ends[0])) return ends[1];
    if (handlePixel.is(ends[1])) return ends[0];
    return null; // If handlePixel is not one of the ends
  }
}

class FreeLineLayer extends BaseLineLayer {
  static type = "free-line";

  drawLayer(activePixel, forceRedraw = false) {
    this.setToPixel(activePixel); // Update the logical 'to' endpoint
    if (!this.fromPixel || !this.toPixel) {
        this.empty(); // Clear if anchors are invalid
        return;
    }

    this.empty(); // Clear previous line pixels

    let fp = this.fromPixel;
    let tp = this.toPixel;
    let dRow = tp.row - fp.row;
    let dCol = tp.col - fp.col;

    let totalSteps = Math.max(Math.abs(dRow), Math.abs(dCol));
    if (totalSteps === 0) { // Single point line
        let char = this.hasArrowLeft || this.hasArrowRight ? charManager.getArrow("right") : charManager.getLateralLine(this.lineForm); // Default for a point
        this.add(fp, char);
        return;
    }

    let rowStep = dRow / totalSteps;
    let colStep = dCol / totalSteps;
    let midLineChar = "x"; // Fallback

    // Determine primary character for the line segment
    if (Math.abs(rowStep) < 0.3) midLineChar = charManager.getLateralLine(this.lineForm);
    else if (Math.abs(colStep) < 0.35) midLineChar = charManager.getVerticalLine(this.lineForm); // Adjusted threshold
    else if ((rowStep > 0 && colStep > 0) || (rowStep < 0 && colStep < 0)) midLineChar = charManager.getDiagBackLine(this.lineForm); // \
    else midLineChar = charManager.getDiagForwardLine(this.lineForm); // /

    // Determine arrow characters for ends
    let startChar = midLineChar, endChar = midLineChar;
    // Simplified arrow direction based on overall vector
    if (Math.abs(dRow) > Math.abs(dCol) * (1/canvas.pixelWidthDivider * 0.5) ) { // More vertical visually
      if (dRow < 0) { // Going Up
        if (this.hasArrowLeft) startChar = charManager.getArrow("down"); // fromPixel is bottom
        if (this.hasArrowRight) endChar = charManager.getArrow("up");   // toPixel is top
      } else { // Going Down
        if (this.hasArrowLeft) startChar = charManager.getArrow("up");     // fromPixel is top
        if (this.hasArrowRight) endChar = charManager.getArrow("down"); // toPixel is bottom
      }
    } else { // More horizontal visually
      if (dCol < 0) { // Going Left
        if (this.hasArrowLeft) startChar = charManager.getArrow("right"); // fromPixel is right
        if (this.hasArrowRight) endChar = charManager.getArrow("left");   // toPixel is left
      } else { // Going Right
        if (this.hasArrowLeft) startChar = charManager.getArrow("left");   // fromPixel is left
        if (this.hasArrowRight) endChar = charManager.getArrow("right");  // toPixel is right
      }
    }

    // Draw the line using Bresenham-like approach
    let currentRow = fp.row;
    let currentCol = fp.col;
    for (let i = 0; i <= totalSteps; i++) {
      let charToUse = midLineChar;
      if (i === 0) charToUse = startChar;
      if (i === totalSteps) charToUse = endChar; // Will overwrite if totalSteps=0
      
      let pixel = canvas.getPixelByRowCol(roundHalf(currentRow), roundHalf(currentCol));
      if (pixel) {
          // Avoid duplicate pixel if start/end char is same as midline for short lines
          const existingIndex = this.pixels.findIndex(p => p.id() === pixel.id());
          if (existingIndex !== -1) {
              this.values[existingIndex] = charToUse; // Prefer endpoint chars
          } else {
              this.add(pixel, charToUse);
          }
      }
      currentRow += rowStep;
      currentCol += colStep;
    }
     // Ensure the very last pixel (toPixel) has the endChar, Bresenham might be slightly off due to rounding
    const finalPixel = canvas.getPixelByRowCol(tp.row, tp.col);
    if (finalPixel) {
        const finalPixelIndex = this.pixels.findIndex(p => p.id() === finalPixel.id());
        if (finalPixelIndex !== -1) {
            this.values[finalPixelIndex] = endChar;
        } else {
            this.add(finalPixel, endChar); // Should be rare if loop is correct
        }
    }
    if (totalSteps === 0 && this.pixels.length > 0) { // Special case for single point to ensure correct char
        this.values[0] = startChar; // Or a combination if both arrows active
    }

  }
}

class StepLineLayer extends BaseLineLayer {
  static type = "step-line";
  verticalFirstPreference = false; // User or logic can toggle this

  getKeyedJointPixels() { // The "elbow" or corner of the step line
    if (this.pixels.length < 2) return this.fromPixel ? { m: this.fromPixel } : {}; // Not enough points for an elbow
    // Find the pixel where direction changes
    let cornerPixel = null;
    if (this.pixels.length > 1) {
        // Heuristic: if drawing horizontal then vertical, corner is at (fromPixel.row, toPixel.col)
        // If drawing vertical then horizontal, corner is at (toPixel.row, fromPixel.col)
        // This depends on the drawFromTo logic's current preference.
        // Let's find it by iterating pixels if they are ordered by draw.
        for(let i = 1; i < this.pixels.length -1; i++) {
            const pPrev = this.pixels[i-1];
            const pCurr = this.pixels[i];
            const pNext = this.pixels[i+1];
            if (!pPrev || !pCurr || !pNext) continue;
            if ((pPrev.row === pCurr.row && pCurr.col !== pNext.col && pCurr.row !== pNext.row) || // H-V turn
                (pPrev.col === pCurr.col && pCurr.row !== pNext.row && pCurr.col !== pNext.col)) { // V-H turn
                cornerPixel = pCurr;
                break;
            }
        }
    }
    return cornerPixel ? { m: cornerPixel } : (this.getLastPixel() ? { m: this.getLastPixel()} : {}); // Fallback to end
  }

  drawLayer(activePixel, forceRedraw = false) {
    this.setToPixel(activePixel);
    if (!this.fromPixel || !this.toPixel) { this.empty(); return; }

    // Decide which way to draw (Horizontal-Vertical or Vertical-Horizontal)
    // Based on overlap or fixed preference
    let layersToAvoid = [TextLayer.type, SquareLayer.type, CircleLayer.type, DiamondLayer.type, TableLayer.type];
    let currentPixels = [...this.pixels]; let currentValues = [...this.values]; // Stash current

    this.drawFromTo(this.fromPixel, this.toPixel, false); // Horizontal first
    let overlapHfirst = layerManager.getNearOverlappingCount(this, layersToAvoid);
    let pixelsHfirst = [...this.pixels]; let valuesHfirst = [...this.values];

    this.pixels = [...currentPixels]; this.values = [...currentValues]; // Restore before next test
    this.drawFromTo(this.fromPixel, this.toPixel, true);  // Vertical first
    let overlapVfirst = layerManager.getNearOverlappingCount(this, layersToAvoid);

    if (this.verticalFirstPreference) { // If user has a preference
        if (overlapVfirst <= overlapHfirst + 2) { // Prefer V-first unless H-first is much better
             // Already drawn V-first
        } else {
            this.pixels = pixelsHfirst; this.values = valuesHfirst;
        }
    } else { // Prefer H-first by default
        if (overlapHfirst <= overlapVfirst + 2) { // Prefer H-first unless V-first is much better
            this.pixels = pixelsHfirst; this.values = valuesHfirst;
        } else {
            // Already drawn V-first
        }
    }
  }

  drawFromTo(fp, tp, preferVerticalFirst) {
    this.empty();
    if (fp.is(tp)) { // Single point
        this.add(fp, this.hasArrowLeft ? charManager.getArrow("left") : charManager.getLateralLine(this.lineForm));
        return;
    }

    let latChar = charManager.getLateralLine(this.lineForm);
    let vertChar = charManager.getVerticalLine(this.lineForm);
    let dRow = tp.row - fp.row;
    let dCol = tp.col - fp.col;

    let cornerR, cornerC;
    let firstSegChar = preferVerticalFirst ? vertChar : latChar;
    let secondSegChar = preferVerticalFirst ? latChar : vertChar;
    let [startChar, endChar] = this.getArrowChars(fp, tp, preferVerticalFirst);


    if (preferVerticalFirst) { // Vertical segment first, then Horizontal
      cornerR = tp.row; cornerC = fp.col;
      // Draw vertical segment from fp to (tp.row, fp.col)
      for (let r = 0; r <= Math.abs(dRow); r++) {
        let curR = fp.row + r * Math.sign(dRow);
        let char = (curR === fp.row) ? startChar : ((curR === tp.row) ? vertChar : vertChar); // Corner char handled later
        if(curR === tp.row && dCol === 0) char = endChar; // Straight vertical line end
        this.add(canvas.getPixelByRowCol(curR, fp.col), char);
      }
      // Draw horizontal segment from (tp.row, fp.col) to tp
      // Skip first point if dRow !== 0 (corner already drawn)
      for (let c = (dRow === 0 ? 0 : 1) ; c <= Math.abs(dCol); c++) {
        let curC = fp.col + c * Math.sign(dCol);
        let char = (curC === tp.col) ? endChar : latChar;
        this.add(canvas.getPixelByRowCol(tp.row, curC), char);
      }
    } else { // Horizontal segment first, then Vertical
      cornerR = fp.row; cornerC = tp.col;
      // Draw horizontal segment from fp to (fp.row, tp.col)
      for (let c = 0; c <= Math.abs(dCol); c++) {
        let curC = fp.col + c * Math.sign(dCol);
        let char = (curC === fp.col) ? startChar : ((curC === tp.col) ? latChar : latChar);
        if(curC === tp.col && dRow === 0) char = endChar; // Straight horizontal line end
        this.add(canvas.getPixelByRowCol(fp.row, curC), char);
      }
      // Draw vertical segment from (fp.row, tp.col) to tp
      for (let r = (dCol === 0 ? 0 : 1); r <= Math.abs(dRow); r++) {
        let curR = fp.row + r * Math.sign(dRow);
        let char = (curR === tp.row) ? endChar : vertChar;
        this.add(canvas.getPixelByRowCol(curR, tp.col), char);
      }
    }
    
    // Set corner character explicitly if there's a turn
    if (dRow !== 0 && dCol !== 0) {
        let cornerPixel = canvas.getPixelByRowCol(cornerR, cornerC);
        if (cornerPixel) {
            const cornerChar = this.getCornerChar(fp, tp, preferVerticalFirst);
            const existingIndex = this.pixels.findIndex(p => p.id() === cornerPixel.id());
            if (existingIndex !== -1) this.values[existingIndex] = cornerChar;
            else this.add(cornerPixel, cornerChar); // Should be covered by loops
        }
    }
  }

  getCornerChar(fp, tp, verticalFirst) {
    if (verticalFirst) { // Turn from Vertical to Horizontal
      if (tp.row > fp.row) { // Going Down then...
        return tp.col > fp.col ? charManager.getCorner(this.lineForm, "top-left") : charManager.getCorner(this.lineForm, "top-right");
      } else { // Going Up then...
        return tp.col > fp.col ? charManager.getCorner(this.lineForm, "bottom-left") : charManager.getCorner(this.lineForm, "bottom-right");
      }
    } else { // Turn from Horizontal to Vertical
      if (tp.col > fp.col) { // Going Right then...
        return tp.row > fp.row ? charManager.getCorner(this.lineForm, "top-right") : charManager.getCorner(this.lineForm, "bottom-right");
      } else { // Going Left then...
        return tp.row > fp.row ? charManager.getCorner(this.lineForm, "top-left") : charManager.getCorner(this.lineForm, "bottom-left");
      }
    }
  }

  getArrowChars(fp, tp, verticalFirst) { // Returns [startChar, endChar]
    let start = verticalFirst ? charManager.getVerticalLine(this.lineForm) : charManager.getLateralLine(this.lineForm);
    let end = verticalFirst ? charManager.getLateralLine(this.lineForm) : charManager.getVerticalLine(this.lineForm);

    if (fp.row === tp.row && fp.col === tp.col) { // Single point
        return [this.hasArrowLeft ? charManager.getArrow("left"): start, end];
    }

    if (this.hasArrowLeft) { // Arrow at fp
      if (verticalFirst) start = (tp.row > fp.row) ? charManager.getArrow("down") : charManager.getArrow("up");
      else start = (tp.col > fp.col) ? charManager.getArrow("right") : charManager.getArrow("left");
    }
    if (this.hasArrowRight) { // Arrow at tp
      if (verticalFirst) end = (tp.col > fp.col) ? charManager.getArrow("right") : charManager.getArrow("left"); // End arrow is on horizontal part
      else end = (tp.row > fp.row) ? charManager.getArrow("down") : charManager.getArrow("up"); // End arrow is on vertical part
    }
    // If line is straight, end character's default should match start's default
    if (fp.row === tp.row && !verticalFirst) end = start; // Straight horizontal
    if (fp.col === tp.col && verticalFirst) end = start;  // Straight vertical

    return [start, end];
  }
}
// ... SwitchLineLayer and other specific layer classes will follow ...
// ... (Previous JavaScript: StepLineLayer class) ...

class SwitchLineLayer extends BaseLineLayer {
  static type = "switch-line";
  prefersVerticalMiddle = false; // Preference for the middle segment's orientation

  getKeyedJointPixels() { // Returns the two "elbows" of the switch line
    if (this.pixels.length < 3) return this.fromPixel ? {0: this.fromPixel, 1: this.fromPixel} : {};
    let elbows = [];
    for (let i = 1; i < this.pixels.length - 1; i++) {
      const p = this.pixels[i], prev = this.pixels[i-1], next = this.pixels[i+1];
      if (!p || !prev || !next) continue;
      // Check for change in direction (H-V or V-H turn)
      const prevDX = p.col - prev.col, prevDY = p.row - prev.row;
      const nextDX = next.col - p.col, nextDY = next.row - p.row;
      if ((prevDX !== 0 && prevDY === 0 && nextDX === 0 && nextDY !== 0) || // H to V
          (prevDX === 0 && prevDY !== 0 && nextDX !== 0 && nextDY === 0)) { // V to H
        elbows.push(p);
      }
    }
    if (elbows.length >= 2) {
        // Sort elbows for consistent keying, e.g., by draw order or position
        // Assuming they are found in draw order:
        return { 0: elbows[0], 1: elbows[1] };
    } else if (elbows.length === 1) { // L-shape, treat the single elbow as both
        return { 0: elbows[0], 1: elbows[0] };
    }
    return this.fromPixel ? {0: this.fromPixel, 1: this.toPixel || this.fromPixel} : {}; // Fallback for straight lines
  }

  drawLayer(activePixel, forceRedraw = false) {
    this.setToPixel(activePixel);
    if (!this.fromPixel || !this.toPixel) { this.empty(); return; }

    let fp = this.fromPixel;
    let tp = this.toPixel;
    let dRow = Math.abs(tp.row - fp.row);
    let dCol = Math.abs(tp.col - fp.col);

    // Overlap check can be complex for switch lines.
    // For now, use a preference or simpler geometric heuristic.
    // If prefersVerticalMiddle is true, draw V-H-V. Else H-V-H.
    // Or, if significantly more distance in one primary direction.
    let drawVerticalMiddle; // True for V-H-V, False for H-V-H
    if (dRow > dCol * 1.5) { // Significantly taller than wide, prefer H-V-H
        drawVerticalMiddle = false;
    } else if (dCol > dRow * 1.5) { // Significantly wider than tall, prefer V-H-V
        drawVerticalMiddle = true;
    } else { // Roughly square or preference-based
        drawVerticalMiddle = this.prefersVerticalMiddle;
    }

    this.drawSegments(fp, tp, drawVerticalMiddle);
  }

  drawSegments(fp, tp, verticalMiddle) { // verticalMiddle true for V-H-V
    this.empty();
    if (fp.is(tp)) { // Single point
        this.add(fp, this.hasArrowLeft ? charManager.getArrow("left") : charManager.getLateralLine(this.lineForm));
        return;
    }

    let latChar = charManager.getLateralLine(this.lineForm);
    let vertChar = charManager.getVerticalLine(this.lineForm);
    let [startChar, endChar] = this.getArrowChars(fp, tp, verticalMiddle);
    let [corner1Char, corner2Char] = this.getCornerChars(fp, tp, verticalMiddle);

    let r1 = fp.row, c1 = fp.col;
    let r2 = tp.row, c2 = tp.col;
    let sgnR = Math.sign(r2 - r1) || 1; // Avoid Math.sign(0) = 0
    let sgnC = Math.sign(c2 - c1) || 1;

    let p1r, p1c, p2r, p2c; // Points for the two corners

    if (verticalMiddle) { // V-H-V pattern
      // p1 is 1/3 vertically, p2 is 2/3 vertically (approx)
      // More simply: first segment vertical, middle horizontal, last vertical.
      let midRow = r1 + sgnR * Math.floor(Math.abs(r2-r1)/2);
      p1r = midRow; p1c = c1; // First turn (V to H)
      p2r = midRow; p2c = c2; // Second turn (H to V)

      this.drawLineSegment(r1, c1, p1r, p1c, vertChar, startChar, corner1Char);
      this.drawLineSegment(p1r, p1c, p2r, p2c, latChar, corner1Char, corner2Char, true); // Middle seg, skip first char
      this.drawLineSegment(p2r, p2c, r2, c2, vertChar, corner2Char, endChar, true);
    } else { // H-V-H pattern
      let midCol = c1 + sgnC * Math.floor(Math.abs(c2-c1)/2);
      p1r = r1; p1c = midCol; // First turn (H to V)
      p2r = r2; p2c = midCol; // Second turn (V to H)

      this.drawLineSegment(r1, c1, p1r, p1c, latChar, startChar, corner1Char);
      this.drawLineSegment(p1r, p1c, p2r, p2c, vertChar, corner1Char, corner2Char, true);
      this.drawLineSegment(p2r, p2c, r2, c2, latChar, corner2Char, endChar, true);
    }
  }

  drawLineSegment(r1, c1, r2, c2, lineChar, firstChar, lastChar, skipFirst = false) {
    let dR = r2 - r1;
    let dC = c2 - c1;
    let steps = Math.max(Math.abs(dR), Math.abs(dC));
    if (steps === 0) { // Single point (likely a corner)
        if (!skipFirst) this.add(canvas.getPixelByRowCol(r1, c1), firstChar);
        return;
    }
    let stepR = dR / steps;
    let stepC = dC / steps;

    for (let i = (skipFirst ? 1 : 0); i <= steps; i++) {
      let curR = roundHalf(r1 + i * stepR);
      let curC = roundHalf(c1 + i * stepC);
      let charToUse = lineChar;
      if (i === 0 && !skipFirst) charToUse = firstChar;
      if (i === steps) charToUse = lastChar;
      
      let pixel = canvas.getPixelByRowCol(curR, curC);
      if(pixel) {
        const existingIndex = this.pixels.findIndex(p => p.id() === pixel.id());
        if(existingIndex !== -1) { // If pixel already exists (e.g. corner)
            if (i === 0 && !skipFirst) this.values[existingIndex] = firstChar; // Prioritize start/end chars
            else if (i === steps) this.values[existingIndex] = lastChar;
            // else keep existing lineChar, or update if needed
        } else {
            this.add(pixel, charToUse);
        }
      }
    }
  }

  getArrowChars(fp, tp, verticalMiddle) {
    let startDefault = verticalMiddle ? charManager.getVerticalLine(this.lineForm) : charManager.getLateralLine(this.lineForm);
    let endDefault = verticalMiddle ? charManager.getVerticalLine(this.lineForm) : charManager.getLateralLine(this.lineForm);
    let start = startDefault, end = endDefault;

    if (this.hasArrowLeft) { // Arrow at fp
      if (verticalMiddle) start = (tp.row > fp.row) ? charManager.getArrow("down") : charManager.getArrow("up");
      else start = (tp.col > fp.col) ? charManager.getArrow("right") : charManager.getArrow("left");
    }
    if (this.hasArrowRight) { // Arrow at tp
      if (verticalMiddle) end = (tp.row > fp.row) ? charManager.getArrow("down") : charManager.getArrow("up"); // End arrow is on the last vertical segment
      else end = (tp.col > fp.col) ? charManager.getArrow("right") : charManager.getArrow("left"); // End arrow is on the last horizontal segment
    }
    return [start, end];
  }

  getCornerChars(fp, tp, verticalMiddle) { // [firstCorner, secondCorner]
    let lf = this.lineForm;
    if (verticalMiddle) { // V-H-V: first turn V to H, second H to V
      let c1, c2;
      if (tp.row > fp.row) { // Going Down
        c1 = (tp.col > fp.col) ? charManager.getCorner(lf, "bottom-left") : charManager.getCorner(lf, "bottom-right");
        c2 = (tp.col > fp.col) ? charManager.getCorner(lf, "top-right") : charManager.getCorner(lf, "top-left");
      } else { // Going Up
        c1 = (tp.col > fp.col) ? charManager.getCorner(lf, "top-left") : charManager.getCorner(lf, "top-right");
        c2 = (tp.col > fp.col) ? charManager.getCorner(lf, "bottom-right") : charManager.getCorner(lf, "bottom-left");
      }
      return [c1, c2];
    } else { // H-V-H: first turn H to V, second V to H
      let c1, c2;
      if (tp.col > fp.col) { // Going Right
        c1 = (tp.row > fp.row) ? charManager.getCorner(lf, "top-right") : charManager.getCorner(lf, "bottom-right");
        c2 = (tp.row > fp.row) ? charManager.getCorner(lf, "bottom-left") : charManager.getCorner(lf, "top-left");
      } else { // Going Left
        c1 = (tp.row > fp.row) ? charManager.getCorner(lf, "top-left") : charManager.getCorner(lf, "bottom-left");
        c2 = (tp.row > fp.row) ? charManager.getCorner(lf, "bottom-right") : charManager.getCorner(lf, "top-right");
      }
      return [c1, c2];
    }
  }
}

class FreeLayer extends Layer {
  static type = "free";
  static freeChar = "█"; // Default character for free drawing
  warningUnicodeChars = ["█", "•"]; // Chars that might look bad in non-unicode

  static setFreeChar(char) { FreeLayer.freeChar = char; }
  static startFreeDraw() {
    layerManager.switchModeCallback();
    modeMaster.reset("draw", "free");
    // The active char is managed by FreeLayer.freeChar, not a mode.
  }

  static decode(encodedLayer) {
    let layer = Layer.decode(encodedLayer);
    if (!layer) return null;
    layer.pixels = (encodedLayer.pxs || []).map(id => canvas.getPixelById(id)).filter(Boolean);
    layer.values = encodedLayer.vls || [];
    if (layer.pixels.length !== layer.values.length) { // Ensure consistency
        console.warn(`FreeLayer ${layer.id} decoded with mismatched pixels/values. Truncating.`);
        const minLen = Math.min(layer.pixels.length, layer.values.length);
        layer.pixels = layer.pixels.slice(0, minLen);
        layer.values = layer.values.slice(0, minLen);
    }
    return layer;
  }

  encode() {
    let encoded = super.encode();
    encoded.pxs = this.pixels.map(p => p.id());
    encoded.vls = this.values;
    // fromPixel and toPixel for FreeLayer track last drawn segment for "_lines" mode
    // or just the last point for single char mode.
    return encoded;
  }

  redraw() { /* FreeLayers are additive; render() takes care of display. No recalculation needed on redraw(). */ }

  characterWarning(value) {
    if (this.warningUnicodeChars.includes(value) && charManager.getCharset() !== "unicode") {
      bodyComponent.informerComponent.report("Warning: Unicode char in non-Unicode mode.", "default");
    }
  }

  drawLayer(activePixel, forceRedraw = false) { // activePixel is current mouse position
    if (!activePixel) return;
    let charToDraw;

    if (FreeLayer.freeChar === "_lines") {
      if (!this.fromPixel || !this.toPixel || !this.fromPixel.is(this.toPixel)) { // If fromPixel isn't set or isn't the last activePixel
          this.setToPixel(activePixel); // Update toPixel to current
          // Draw line segment from fromPixel to toPixel (activePixel)
          // This needs Bresenham or similar line drawing for the "_lines" mode.
          // For simplicity, we'll just add points along the line here.
          // A proper implementation would be like FreeLineLayer's drawing.
          if (this.fromPixel && this.toPixel) {
              let fp = this.fromPixel; let tp = this.toPixel;
              let dRow = tp.row - fp.row, dCol = tp.col - fp.col;
              let steps = Math.max(Math.abs(dRow), Math.abs(dCol));
              let charForLine = Math.abs(dRow) > Math.abs(dCol) ? charManager.getVerticalLine(this.lineForm) : charManager.getLateralLine(this.lineForm);
              if (steps > 0) {
                  for (let i=0; i<=steps; i++) {
                      const r = roundHalf(fp.row + (dRow * i / steps));
                      const c = roundHalf(fp.col + (dCol * i / steps));
                      const p = canvas.getPixelByRowCol(r,c);
                      if(p) this.addOrUpdatePixel(p, charForLine);
                  }
              } else { // Single point if from and to are same
                  this.addOrUpdatePixel(activePixel, charForLine);
              }
          }
          this.setFromPixel(activePixel); // For next segment
          this.setToPixel(activePixel); // Current point
          return; // Done for "_lines" mode segment
      } else { // First point of a "_lines" stroke
          charToDraw = charManager.getLateralLine(this.lineForm); // Default first point
      }
    } else {
      charToDraw = FreeLayer.freeChar;
    }

    this.characterWarning(charToDraw);
    this.addOrUpdatePixel(activePixel, charToDraw);
    this.setFromPixel(activePixel); // Track last drawn point
    this.setToPixel(activePixel);
  }

  addOrUpdatePixel(pixel, value) {
    const existingIndex = this.getPixelIndex(pixel.id());
    if (existingIndex !== -1) {
      this.values[existingIndex] = value; // Update if pixel already part of this layer
    } else {
      this.add(pixel, value); // Add new pixel
    }
  }
}

class SquareBoundLayer extends Layer { // Base for Square, Table
  static lineBased = true; // Uses line characters for its border

  getCornerPixels() { // Returns [TL, TR, BR, BL] Pixel objects or empty array
    if ((this.pixels.length === 0 && (!this.fromPixel || !this.toPixel))) {
      return [];
    }
    let minR, minC, maxR, maxC;
    if (this.pixels.length > 0) {
      [maxC, minC, maxR, minR] = this.getMinMaxRowsCols();
      if (minC === -1) return []; // Not drawn yet / empty
    } else { // Estimate from fromPixel and toPixel if not drawn
      minR = Math.min(this.fromPixel.row, this.toPixel.row);
      minC = Math.min(this.fromPixel.col, this.toPixel.col);
      maxR = Math.max(this.fromPixel.row, this.toPixel.row);
      maxC = Math.max(this.fromPixel.col, this.toPixel.col);
    }
    const tl = canvas.getPixelByRowCol(minR, minC);
    const tr = canvas.getPixelByRowCol(minR, maxC);
    const br = canvas.getPixelByRowCol(maxR, maxC);
    const bl = canvas.getPixelByRowCol(maxR, minC);
    return (tl && tr && br && bl) ? [tl, tr, br, bl] : [];
  }

  getResizePixels() { return this.getCornerPixels(); }

  getResizeOppositePixel(targetHandlePixel) {
    if (!targetHandlePixel) return null;
    const corners = this.getCornerPixels();
    if (corners.length < 4) return null;
    const handleIndex = corners.findIndex(c => c.is(targetHandlePixel));
    if (handleIndex === -1) return null;
    return corners[(handleIndex + 2) % 4]; // Opposite corner
  }
}

// ... CircleLayer, DiamondLayer, SquareLayer, TableLayer will follow ...
// ... (Previous JavaScript: FreeLayer and SquareBoundLayer classes) ...

class CircleLayer extends Layer { // Does not extend SquareBoundLayer directly
  static type = "circle";
  static lineBased = true;

  // For Circle, fromPixel is the center, toPixel defines a point on circumference
  // to establish radius.

  getKeyedJointPixels() { // Top, Right, Bottom, Left points on circumference
    if (this.pixels.length < 4 && !this.fromPixel) return {};
    const extremes = this.getExtremeEdgePixels();
    if (!extremes) { // Fallback if no pixels drawn yet but fromPixel (center) exists
        return this.fromPixel ? {
            t: this.fromPixel, r: this.fromPixel,
            b: this.fromPixel, l: this.fromPixel
        } : {};
    }
    // Joints are slightly outside these extreme points for lines to connect cleanly
    return {
      t: canvas.getPixelByRowCol(extremes.topPx.row - 1, extremes.topPx.col),
      r: canvas.getPixelByRowCol(extremes.rightPx.row, extremes.rightPx.col + 1),
      b: canvas.getPixelByRowCol(extremes.bottomPx.row + 1, extremes.bottomPx.col),
      l: canvas.getPixelByRowCol(extremes.leftPx.row, extremes.leftPx.col - 1),
    };
  }

  getExtremeEdgePixels() { // Finds pixels at N, E, S, W extremities of the drawn circle
    if (this.pixels.length === 0) return null;
    let topPx = this.pixels[0], bottomPx = this.pixels[0];
    let leftPx = this.pixels[0], rightPx = this.pixels[0];
    for (let p of this.pixels) {
      if (!p) continue;
      if (p.row < topPx.row) topPx = p;
      if (p.row > bottomPx.row) bottomPx = p;
      if (p.col < leftPx.col) leftPx = p;
      if (p.col > rightPx.col) rightPx = p;
    }
    return { topPx, bottomPx, leftPx, rightPx };
  }

  getResizePixels() { // N, E, S, W points are good resize handles
    const extremes = this.getExtremeEdgePixels();
    return extremes ? [extremes.topPx, extremes.rightPx, extremes.bottomPx, extremes.leftPx].filter(Boolean) : [];
  }

  getResizeOppositePixel(targetHandlePixel) {
    // For a circle, resizing from any edge point should ideally scale relative to the center.
    // The "opposite" for calculation is the circle's center (this.fromPixel).
    return this.fromPixel || null;
  }

  drawLayer(activePixel, forceRedraw = false) { // activePixel is a point on circumference
    this.setToPixel(activePixel);
    if (!this.fromPixel || !this.toPixel) { this.empty(); return; }

    this.empty();
    const centerX = this.fromPixel.col;
    const centerY = this.fromPixel.row;
    const edgeX = this.toPixel.col;
    const edgeY = this.toPixel.row;

    // Calculate radius, considering character aspect ratio (pixelWidthDivider)
    // Effective dx needs to be scaled if character cells are not square.
    // If char width is half height (divider=0.5), then graphical distance for cols is halved.
    const dx = (edgeX - centerX) / (canvas.pixelWidthDivider * 2); // Scale horizontal distance
    const dy = edgeY - centerY;
    const radius = Math.round(Math.sqrt(dx * dx + dy * dy));

    if (radius === 0) { // Single point circle
      this.add(this.fromPixel, charManager.getBestChar("generic", this.lineForm, charManager.getCharset()));
      return;
    }

    // Midpoint circle algorithm (adapted for character grid)
    let x = radius;
    let y = 0;
    let err = 1 - radius; // Error term, or p = 1 - radius for integer arithmetic

    const latChar = charManager.getLateralLine(this.lineForm);
    const vertChar = charManager.getVerticalLine(this.lineForm);
    // Could use diagonal chars for better look, but harder with simple midpoint.
    // For now, use lat/vert based on which part of curve is being drawn.

    while (x >= y) {
      // Plot 8 symmetric points, mapping (x,y) from ideal circle to char grid
      // (y, x) pairs are more "vertical" parts, (x, y) more "horizontal"
      // Need to scale x when used for column offset due to aspect ratio
      const scaledX = Math.round(x * canvas.pixelWidthDivider * 2);
      const scaledY = Math.round(y * canvas.pixelWidthDivider * 2);

      this.addSafe(centerY + y, centerX + scaledX, latChar); // (y, x) region
      this.addSafe(centerY + y, centerX - scaledX, latChar);
      this.addSafe(centerY - y, centerX + scaledX, latChar);
      this.addSafe(centerY - y, centerX - scaledX, latChar);

      this.addSafe(centerY + x, centerX + scaledY, vertChar); // (x, y) region
      this.addSafe(centerY + x, centerX - scaledY, vertChar);
      this.addSafe(centerY - x, centerX + scaledY, vertChar);
      this.addSafe(centerY - x, centerX - scaledY, vertChar);

      y++;
      if (err <= 0) {
        err += 2 * y + 1;
      } else {
        x--;
        err += 2 * (y - x) + 1;
      }
    }
  }
  addSafe(r, c, char) { // Helper for drawLayer
    const p = canvas.getPixelByRowCol(r, c);
    if (p) {
        // Avoid duplicates if algorithm plots same char grid pixel from different ideal points
        if (!this.pixels.find(ep => ep.id() === p.id())) {
            this.add(p, char);
        }
    }
  }
}

class DiamondLayer extends Layer {
  static type = "diamond";
  static lineBased = true;
  // fromPixel is center, toPixel defines half-width/height

  getKeyedJointPixels() { // Top, Right, Bottom, Left apexes
    const extremes = this.getExtremeApexPixels();
    if (!extremes) return this.fromPixel ? { t:this.fromPixel, r:this.fromPixel,b:this.fromPixel,l:this.fromPixel } : {};
    return {
      t: extremes.topApex, r: extremes.rightApex,
      b: extremes.bottomApex, l: extremes.leftApex,
    };
  }

  getExtremeApexPixels() {
    if (!this.fromPixel || !this.toPixel) return null;
    const hRadius = Math.abs(this.toPixel.row - this.fromPixel.row);
    // Effective horizontal radius in character cells
    const wRadiusChars = Math.round(Math.abs(this.toPixel.col - this.fromPixel.col) / (canvas.pixelWidthDivider * 2 || 1));

    return {
      topApex: canvas.getPixelByRowCol(this.fromPixel.row - hRadius, this.fromPixel.col),
      bottomApex: canvas.getPixelByRowCol(this.fromPixel.row + hRadius, this.fromPixel.col),
      leftApex: canvas.getPixelByRowCol(this.fromPixel.row, this.fromPixel.col - wRadiusChars),
      rightApex: canvas.getPixelByRowCol(this.fromPixel.row, this.fromPixel.col + wRadiusChars),
    };
  }

  getResizePixels() {
    const extremes = this.getExtremeApexPixels();
    return extremes ? [extremes.topApex, extremes.rightApex, extremes.bottomApex, extremes.leftApex].filter(Boolean) : [];
  }

  getResizeOppositePixel(targetHandlePixel) {
    // Resizing diamond from an apex scales relative to center (fromPixel)
    return this.fromPixel || null;
  }

  drawLayer(activePixel, forceRedraw = false) {
    this.setToPixel(activePixel);
    if (!this.fromPixel || !this.toPixel) { this.empty(); return; }
    this.empty();

    const diagBack = charManager.getDiagBackLine(this.lineForm);   // '\'
    const diagFwd = charManager.getDiagForwardLine(this.lineForm); // '/'
    const apexVert = charManager.getDiamondCorner(this.lineForm, "vertical") || diagBack;
    const apexLat = charManager.getDiamondCorner(this.lineForm, "lateral") || diagFwd;

    const extremes = this.getExtremeApexPixels();
    if (!extremes || !Object.values(extremes).every(Boolean)) {
        if (this.fromPixel.is(this.toPixel)) this.add(this.fromPixel, apexVert); // Single point
        return;
    }
    const { topApex, bottomApex, leftApex, rightApex } = extremes;

    // Helper to draw a line segment for diamond edges
    const drawDiamondLine = (p1r, p1c, p2r, p2c, char) => {
        let dr = p2r - p1r, dc = p2c - p1c;
        let steps = Math.max(Math.abs(dr), Math.abs(dc));
        if (steps === 0) { this.add(canvas.getPixelByRowCol(p1r,p1c), char); return; }
        let sr = dr/steps, sc = dc/steps;
        for (let i = 0; i <= steps; i++) {
            const r = roundHalf(p1r + i * sr);
            const c = roundHalf(p1c + i * sc);
            this.add(canvas.getPixelByRowCol(r,c), char);
        }
    };

    drawDiamondLine(topApex.row, topApex.col, rightApex.row, rightApex.col, diagBack);
    drawDiamondLine(rightApex.row, rightApex.col, bottomApex.row, bottomApex.col, diagFwd);
    drawDiamondLine(bottomApex.row, bottomApex.col, leftApex.row, leftApex.col, diagBack);
    drawDiamondLine(leftApex.row, leftApex.col, topApex.row, topApex.col, diagFwd);

    // Ensure apex characters are set correctly (line drawing might overwrite)
    this.addOrUpdatePixelValue(topApex, apexVert);
    this.addOrUpdatePixelValue(bottomApex, apexVert);
    this.addOrUpdatePixelValue(leftApex, apexLat);
    this.addOrUpdatePixelValue(rightApex, apexLat);
  }
  addOrUpdatePixelValue(pixel, value) { // Helper
      if (!pixel) return;
      const idx = this.getPixelIndex(pixel.id());
      if (idx !== -1) this.values[idx] = value;
      else this.add(pixel, value);
  }
}

class SquareLayer extends SquareBoundLayer {
  static type = "square";

  getKeyedJointPixels() { // tl, tr, br, bl, and midpoints t, r, b, l
    const corners = this.getCornerPixels();
    if (corners.length < 4) return this.fromPixel ? {tl:this.fromPixel} : {}; // Basic fallback

    const [tl, tr, br, bl] = corners;
    const midRow = tl.row + roundHalf((bl.row - tl.row) / 2);
    const midCol = tl.col + roundHalf((tr.col - tl.col) / 2);

    return {
      tl, tr, br, bl,
      t: canvas.getPixelByRowCol(tl.row - 1, midCol), // Top middle
      r: canvas.getPixelByRowCol(midRow, tr.col + 1), // Right middle
      b: canvas.getPixelByRowCol(bl.row + 1, midCol), // Bottom middle
      l: canvas.getPixelByRowCol(midRow, tl.col - 1), // Left middle
    };
  }

  drawLayer(activePixel, forceRedraw = false) {
    this.setToPixel(activePixel);
    if (!this.fromPixel || !this.toPixel) { this.empty(); return; }
    this.empty();

    const r1 = Math.min(this.fromPixel.row, this.toPixel.row);
    const c1 = Math.min(this.fromPixel.col, this.toPixel.col);
    const r2 = Math.max(this.fromPixel.row, this.toPixel.row);
    const c2 = Math.max(this.fromPixel.col, this.toPixel.col);

    if (r1 === r2 && c1 === c2) { // Single point
      this.add(canvas.getPixelByRowCol(r1, c1), charManager.getCorner(this.lineForm, "top-left"));
      return;
    }

    const latChar = charManager.getLateralLine(this.lineForm);
    const vertChar = charManager.getVerticalLine(this.lineForm);
    const tlChar = charManager.getCorner(this.lineForm, "top-left");
    const trChar = charManager.getCorner(this.lineForm, "top-right");
    const blChar = charManager.getCorner(this.lineForm, "bottom-left");
    const brChar = charManager.getCorner(this.lineForm, "bottom-right");

    // Draw corners
    this.add(canvas.getPixelByRowCol(r1, c1), tlChar);
    if (c1 !== c2) this.add(canvas.getPixelByRowCol(r1, c2), trChar); // Avoid if 1-col wide
    if (r1 !== r2) this.add(canvas.getPixelByRowCol(r2, c1), blChar); // Avoid if 1-row high
    if (r1 !== r2 && c1 !== c2) this.add(canvas.getPixelByRowCol(r2, c2), brChar);


    // Draw horizontal lines
    for (let c = c1 + 1; c < c2; c++) {
      this.add(canvas.getPixelByRowCol(r1, c), latChar);
      if (r1 !== r2) this.add(canvas.getPixelByRowCol(r2, c), latChar);
    }
    // Draw vertical lines
    for (let r = r1 + 1; r < r2; r++) {
      this.add(canvas.getPixelByRowCol(r, c1), vertChar);
      if (c1 !== c2) this.add(canvas.getPixelByRowCol(r, c2), vertChar);
    }
  }
}

class TableLayer extends SquareBoundLayer {
  static type = "table";

  constructor(firstPixelId) {
    super(firstPixelId);
    this.tblSizeLimit = 20; // Max rows/cols
    this.defaultCellContents = " "; // Default to space, text layer will put starterChar
    this.tblColDefaultWidth = 5; // Min char width for a cell content
    this.tblRowDefaultHeight = 1; // Min char height for a cell content (1 line)

    this.cellTextArchive = {}; // { "r,c": ["c","o","n","t","e","n","t"] }
    this.textLayers = {};      // { "r,c": textLayerId }
    this.tblRows = 0;          // Number of content rows
    this.tblCols = 0;          // Number of content columns
    this.tblColWidths = {};    // { colIndex: charWidth }
    this.tblRowHeights = {};   // { rowIndex: charHeight (lines) }
  }

  static decode(encodedLayer) {
    let layer = Layer.decode(encodedLayer);
    if (!layer) return null;
    layer.tblCols = encodedLayer.tblc || 0;
    layer.tblRows = encodedLayer.tblr || 0;
    layer.tblColWidths = encodedLayer.tblws || {};
    layer.tblRowHeights = encodedLayer.tblhs || {};
    layer.textLayers = encodedLayer.tbltx || {};
    // cellTextArchive is transient for runtime, not usually part of core save data.
    // If needed, it could be encoded/decoded.
    // After decoding, TextLayers corresponding to tbltx IDs need to be linked.
    // This is handled during LayerManager.import post-processing.
    return layer;
  }

  encode() {
    let encoded = super.encode();
    encoded.tblc = this.tblCols;
    encoded.tblr = this.tblRows;
    encoded.tblws = this.tblColWidths;
    encoded.tblhs = this.tblRowHeights;
    encoded.tbltx = this.textLayers;
    return encoded;
  }

  stash() {
    super.stash();
    this.stashed.tblCols = this.tblCols;
    this.stashed.tblRows = this.tblRows;
    this.stashed.tblColWidths = structuredClone(this.tblColWidths);
    this.stashed.tblRowHeights = structuredClone(this.tblRowHeights);
    this.stashed.textLayers = structuredClone(this.textLayers);
    this.stashed.cellTextArchive = structuredClone(this.cellTextArchive);
  }

  rollback() {
    super.rollback();
    this.tblCols = this.stashed.tblCols !== undefined ? this.stashed.tblCols : 0;
    this.tblRows = this.stashed.tblRows !== undefined ? this.stashed.tblRows : 0;
    this.tblColWidths = this.stashed.tblColWidths ? structuredClone(this.stashed.tblColWidths) : {};
    this.tblRowHeights = this.stashed.tblRowHeights ? structuredClone(this.stashed.tblRowHeights) : {};
    this.textLayers = this.stashed.textLayers ? structuredClone(this.stashed.textLayers) : {};
    this.cellTextArchive = this.stashed.cellTextArchive ? structuredClone(this.stashed.cellTextArchive) : {};
  }

  copy(identical = false) {
    let layerCopy = super.copy(identical);
    if (!layerCopy) return null;
    layerCopy.tblCols = this.tblCols;
    layerCopy.tblRows = this.tblRows;
    layerCopy.tblColWidths = structuredClone(this.tblColWidths);
    layerCopy.tblRowHeights = structuredClone(this.tblRowHeights);
    layerCopy.cellTextArchive = identical ? structuredClone(this.cellTextArchive) : {}; // Archive not copied for user copy

    if (identical) {
      layerCopy.textLayers = structuredClone(this.textLayers); // Copies map of IDs
    } else {
      layerCopy.textLayers = {}; // New text layers will be created for a user copy
    }
    return layerCopy;
  }
// ... TableLayer continues ...
// ... (Previous JavaScript: Start of TableLayer class) ...

  // --- TableLayer specific methods ---
  getKeyedJointPixels() { // Joints along the outer edges of the table
    const pixels = {};
    const corners = this.getCornerPixels(); // [TL, TR, BR, BL]
    if (corners.length < 4) return {};

    const [tl, tr, br, bl] = corners;
    let currentY = tl.row; // Top edge of first row's content area

    // Side joints (left and right edges, per row)
    for (let r = 0; r < this.tblRows; r++) {
      const rowH = this.getRowHeight(r); // Content height of row r
      const midRowY = currentY + Math.floor(rowH / 2);
      pixels[`l-${r}`] = canvas.getPixelByRowCol(midRowY, tl.col - 1); // Left of row r
      pixels[`r-${r}`] = canvas.getPixelByRowCol(midRowY, tr.col + 1); // Right of row r
      currentY += rowH + 1; // Move to top edge of next row's content (+1 for line)
    }

    // Top and bottom joints (per column)
    let currentX = tl.col; // Left edge of first col's content area
    for (let c = 0; c < this.tblCols; c++) {
      const colW = this.getColWidth(c); // Content width of col c
      const midColX = currentX + Math.floor(colW / 2);
      pixels[`t-${c}`] = canvas.getPixelByRowCol(tl.row - 1, midColX); // Above col c
      pixels[`b-${c}`] = canvas.getPixelByRowCol(br.row + 1, midColX); // Below col c
      currentX += colW + 1; // Move to left edge of next col's content (+1 for line)
    }
    return pixels;
  }

  // Calculates how many rows/cols fit within a given pixel span
  getNewTblRows(verticalPixelSpan) {
    let numRows = 0;
    let currentHeight = 0; // Initial top border
    while (numRows < this.tblSizeLimit) {
      currentHeight += this.getRowHeight(numRows) + 1; // Content height + 1 line
      if (currentHeight -1 > verticalPixelSpan) break; // -1 because last line is part of span
      numRows++;
    }
    return numRows;
  }
  getNewTblCols(lateralPixelSpan) {
    let numCols = 0;
    let currentWidth = 0; // Initial left border
    while (numCols < this.tblSizeLimit) {
      currentWidth += this.getColWidth(numCols) + 1; // Content width + 1 line
      if (currentWidth -1 > lateralPixelSpan) break;
      numCols++;
    }
    return numCols;
  }

  drawLayer(activePixel, forceRedraw = false) { // activePixel is the bottom-right drag point
    this.setToPixel(activePixel);
    if (!this.fromPixel || !this.toPixel) { this.empty(); return; }

    const topLeftBounds = this.getTopLeftPixel(); // Calculated from fromPixel, toPixel
    const bottomRightBounds = this.getBottomRightPixel();
    if (!topLeftBounds || !bottomRightBounds) { this.empty(); return; }

    let verticalPixelSpan = Math.max(0, bottomRightBounds.row - topLeftBounds.row);
    let lateralPixelSpan = Math.max(0, bottomRightBounds.col - topLeftBounds.col);

    let newRows = this.getNewTblRows(verticalPixelSpan);
    let newCols = this.getNewTblCols(lateralPixelSpan);

    if (!forceRedraw) { // Only apply limits and checks if not a forced internal redraw
      if (newRows === this.tblRows && newCols === this.tblCols) return; // No change
      if (newRows === 0 || newCols === 0) {
          // Will be caught by isHappy() during commit to prevent 0x0 tables
      }
      if (newRows > this.tblSizeLimit || newCols > this.tblSizeLimit) {
        bodyComponent.informerComponent.report("Table size limit reached.", "bad");
        newRows = Math.min(newRows, this.tblSizeLimit);
        newCols = Math.min(newCols, this.tblSizeLimit);
      }
    }
    
    this.tblRows = newRows;
    this.tblCols = newCols;

    // --- Drawing Process ---
    this.drawFrame(topLeftBounds); // Draws the table grid lines
    this.archiveOrRemoveTextLayers(); // Manage existing text layers
    this.addOrReviveTextLayers(topLeftBounds); // Create/update text layers for visible cells
    this.moveTextLayers(topLeftBounds); // Ensure text layers are positioned correctly
    // Grouping handled by LayerManager during copy or explicit group actions
  }

  isHappy() {
    if (this.tblRows === 0 || this.tblCols === 0) return false;
    if (this.tblRows > this.tblSizeLimit || this.tblCols > this.tblSizeLimit) return false;
    return super.isHappy();
  }

  drawFrame(topLeftActualPixel) { // Draws the grid lines
    this.empty(); // Clear existing table lines (this.pixels for TableLayer itself)
    if (!topLeftActualPixel || this.tblRows === 0 || this.tblCols === 0) return;

    const lf = this.lineForm;
    const latChar = charManager.getLateralLine(lf);
    const vertChar = charManager.getVerticalLine(lf);
    const crossChar = charManager.getBestChar("cross", lf, charManager.getCharset()) || "+";
    // More specific T-junctions could be used here too.

    let currentY = topLeftActualPixel.row;
    for (let r = 0; r <= this.tblRows; r++) { // Iterate one more for bottom border
      let currentX = topLeftActualPixel.col;
      for (let c = 0; c <= this.tblCols; c++) { // Iterate one more for right border
        let charToUse;
        // Determine corner/junction character based on r, c, tblRows, tblCols
        if (r === 0 && c === 0) charToUse = charManager.getCorner(lf, "top-left");
        else if (r === 0 && c === this.tblCols) charToUse = charManager.getCorner(lf, "top-right");
        else if (r === this.tblRows && c === 0) charToUse = charManager.getCorner(lf, "bottom-left");
        else if (r === this.tblRows && c === this.tblCols) charToUse = charManager.getCorner(lf, "bottom-right");
        else if (r === 0) charToUse = charManager.getBestChar("t-junction", "top", lf) || latChar; // Top T
        else if (r === this.tblRows) charToUse = charManager.getBestChar("t-junction", "bottom", lf) || latChar; // Bottom T
        else if (c === 0) charToUse = charManager.getBestChar("t-junction", "left", lf) || vertChar; // Left T
        else if (c === this.tblCols) charToUse = charManager.getBestChar("t-junction", "right", lf) || vertChar; // Right T
        else charToUse = crossChar;

        this.add(canvas.getPixelByRowCol(currentY, currentX), charToUse);

        // Draw horizontal segment to the right (if not last column grid line)
        if (c < this.tblCols) {
          const colW = this.getColWidth(c);
          for (let i = 1; i < colW; i++) this.add(canvas.getPixelByRowCol(currentY, currentX + i), latChar);
          currentX += colW;
        }
      }
      // Move to next row's Y, and draw vertical segments downwards
      if (r < this.tblRows) {
        const rowH = this.getRowHeight(r);
        let lineX = topLeftActualPixel.col;
        for (let cIdx = 0; cIdx <= this.tblCols; cIdx++) { // Iterate through vertical grid lines
          for (let i = 1; i < rowH; i++) this.add(canvas.getPixelByRowCol(currentY + i, lineX), vertChar);
          if (cIdx < this.tblCols) lineX += this.getColWidth(cIdx);
        }
        currentY += rowH;
      }
    }
  }

  drawRefreshSpacing(textLayerIdCausingChange) {
    // This is called when a TextLayer within a cell changes size.
    const topLeftPixel = this.getTopLeftPixel();
    if (!topLeftPixel) return;

    this.updateCellDimensionsFromTextLayer(textLayerIdCausingChange);

    // Commit the changes to this table layer. This will internally call drawLayer if happy.
    let committed = this.commit(() => {
        this.drawFrame(topLeftPixel); // Redraw grid
        this.moveTextLayers(topLeftPixel); // Reposition all text layers
        // Update table's own toPixel based on new total size
        const corners = this.getCornerPixels();
        if (corners && corners.length === 4) {
            // this.fromPixel should be stable (topLeftPixel)
            this.setToPixel(corners[2]); // Set to bottom-right based on new content
        }
    });

    if (committed) {
      this.resizeJoinerLayers(true);
      const textLayer = layerManager.getLayerById(textLayerIdCausingChange);
      if (textLayer) textLayer.commit(() => {}); // Re-check text layer happiness
      // triggerChanged will be called by the TextLayer's commit if it also succeeds
    } else {
      bodyComponent.informerComponent.report("Table resize failed.", "bad");
    }
  }

  makeCellId(r, c) { return `${r},${c}`; }
  parseCellId(cellIdStr) { return cellIdStr.split(",").map(Number); }

  getTopLeftPixel() { // Top-left canvas pixel of the table frame
    if (!this.fromPixel || !this.toPixel) return null;
    return canvas.getPixelByRowCol(
      Math.min(this.fromPixel.row, this.toPixel.row),
      Math.min(this.fromPixel.col, this.toPixel.col)
    );
  }

  getTextLayers() { // Returns array of TextLayer objects in this table
    return Object.values(this.textLayers)
                 .map(id => layerManager.getLayerById(id))
                 .filter(Boolean);
  }
  getCellFromTextLayerId(textLayerId) {
    for (let cellId in this.textLayers) {
      if (this.textLayers[cellId] === textLayerId) return this.parseCellId(cellId);
    }
    return null;
  }

  // --- Cell Content and Dimension Management ---
  getRowHeight(rowIndex) { return this.tblRowHeights[rowIndex] || this.tblRowDefaultHeight; }
  getColWidth(colIndex) { return this.tblColWidths[colIndex] || this.tblColDefaultWidth; }
  setRowHeight(rowIndex, height) { this.tblRowHeights[rowIndex] = Math.max(1, height); }
  setColWidth(colIndex, width) { this.tblColWidths[colIndex] = Math.max(1, width); }

  archiveOrRemoveTextLayers() { // When table resizes smaller
    const newTextLayersMap = {};
    const layersToFullyRemoveFromManager = [];

    for (let cellIdStr in this.textLayers) {
      const [r, c] = this.parseCellId(cellIdStr);
      const textLayerId = this.textLayers[cellIdStr];
      const textLayer = layerManager.getLayerById(textLayerId);

      if (r < this.tblRows && c < this.tblCols) { // Cell is still visible
        newTextLayersMap[cellIdStr] = textLayerId;
      } else { // Cell no longer visible
        if (textLayer) {
          this.cellTextArchive[cellIdStr] = textLayer.contents; // Archive content
          textLayer.empty(); // Clear its pixels from canvas
          layersToFullyRemoveFromManager.push(textLayerId); // Mark for removal from global list
        }
      }
    }
    this.textLayers = newTextLayersMap;
    // Actual deletion from layerManager.layers is handled by layerManager.tidyLayers,
    // which is called during triggerChanged().
  }

  addOrReviveTextLayers(tableTopLeftPixel) { // When table resizes larger or initially drawn
    if (!tableTopLeftPixel) return;
    let currentAbsoluteY = tableTopLeftPixel.row + 1; // Start inside first cell border

    for (let r = 0; r < this.tblRows; r++) {
      let currentAbsoluteX = tableTopLeftPixel.col + 1;
      for (let c = 0; c < this.tblCols; c++) {
        const cellId = this.makeCellId(r, c);
        if (!this.textLayers[cellId]) { // If no text layer for this visible cell
          const cellContentStartPixel = canvas.getPixelByRowCol(currentAbsoluteY, currentAbsoluteX);
          if (!cellContentStartPixel) {
            console.error(`Table: Cannot get pixel for new/revived cell ${r},${c}`);
            currentAbsoluteX += this.getColWidth(c) + 1;
            continue;
          }
          let newTextLayer = new TextLayer(cellContentStartPixel.id(), this.id);
          newTextLayer.contents = this.cellTextArchive[cellId] || this.defaultCellContents.split("");
          if (newTextLayer.contents.join("") === this.defaultCellContents) { // Add starter char if default
              newTextLayer.setStarterChar();
              newTextLayer.noWrites = true;
          }
          delete this.cellTextArchive[cellId]; // Used or was never archived

          layerManager.addSecond(newTextLayer); // Add behind table layer but on top of others
          this.textLayers[cellId] = newTextLayer.id;
          newTextLayer.commit(() => newTextLayer.drawLayer(null, true));
          this.updateCellDimensionsFromTextLayer(newTextLayer.id); // Update table dims
        }
        currentAbsoluteX += this.getColWidth(c) + 1; // Move to next cell's X start
      }
      currentAbsoluteY += this.getRowHeight(r) + 1; // Move to next row's Y start
    }
  }

  updateCellDimensionsFromTextLayer(textLayerId) {
    const textLayer = layerManager.getLayerById(textLayerId);
    if (!textLayer || !textLayer.is("text")) return;
    const cellRC = this.getCellFromTextLayerId(textLayerId);
    if (!cellRC) return;
    const [r, c] = cellRC;

    const lineLens = textLayer.getLineLengths();
    const textHeightInLines = lineLens.length;
    const textWidthInChars = lineLens.length > 0 ? Math.max(0, ...lineLens) : 0;

    let changed = false;
    if (textHeightInLines > this.getRowHeight(r)) {
        this.setRowHeight(r, textHeightInLines);
        changed = true;
    }
    if (textWidthInChars > this.getColWidth(c)) {
        this.setColWidth(c, textWidthInChars);
        changed = true;
    }
    // If dimensions potentially shrunk, need to check all cells in row/col
    // For now, only grow. Shrinking requires finding new max.
    return changed;
  }

  moveTextLayers(tableTopLeftPixel) { // Reposition existing TextLayers within cells
    if (!tableTopLeftPixel) return;
    let currentAbsoluteY = tableTopLeftPixel.row + 1;

    for (let r = 0; r < this.tblRows; r++) {
      let currentAbsoluteX = tableTopLeftPixel.col + 1;
      for (let c = 0; c < this.tblCols; c++) {
        const cellId = this.makeCellId(r, c);
        const textLayer = this.getTextLayer(cellId);
        if (textLayer && textLayer.fromPixel) {
          const targetPixel = canvas.getPixelByRowCol(currentAbsoluteY, currentAbsoluteX);
          if (targetPixel && !textLayer.fromPixel.is(targetPixel)) {
            let vDiff = targetPixel.row - textLayer.fromPixel.row;
            let lDiff = targetPixel.col - textLayer.fromPixel.col;
            textLayer.commit(() => textLayer.move(vDiff, lDiff));
          }
        }
        currentAbsoluteX += this.getColWidth(c) + 1;
      }
      currentAbsoluteY += this.getRowHeight(r) + 1;
    }
  }
}


/////////////////////
//// COMPONENTS ///// (UI Elements)
/////////////////////

class Component {
  _MagicMethodEventPrefix = "on"; // e.g., on_click becomes onclick event
  _MagicPropCssPrefix = "css";    // e.g., css_color becomes style.color
  _MagicPropCustomPrefix = "prop"; // e.g., prop_placeholder becomes placeholder attribute

  value = "";         // Typically innerHTML or input value
  children = [];      // Array of child Component instances
  type = "div";       // Default HTML tag to create
  element = null;     // The actual DOM element
  parent = null;      // Parent Component instance
  accessibleBy = null;// Key to access this component from its parent (e.g., parent.myButton)
  visible = true;
  skipChildrenTheme = false; // If true, renderTheme won't recurse to children

  constructor(props) {
    if (props) {
      for (let propName in props) {
        if (props.hasOwnProperty(propName)) {
          this[propName] = props[propName];
        }
      }
    }
    // Children might be passed in props, ensure they are part of this.children
    if (props && props.children && Array.isArray(props.children)) {
        this.children = [...this.children, ...props.children];
    }
  }

  create() {
    if (!this.element) { // Create element if it doesn't exist
        this.element = document.createElement(this.type);
    }
  }

  registerMagicProps() {
    if (!this.element) this.create(); // Ensure element exists

    // Collect all own and inherited properties/methods
    let allPropsAndMethods = new Set();
    let currentProto = this;
    while (currentProto && currentProto !== Object.prototype) {
        Object.getOwnPropertyNames(currentProto).forEach(name => allPropsAndMethods.add(name));
        currentProto = Object.getPrototypeOf(currentProto);
    }
    // Also add instance properties (defined directly on `this`)
    Object.keys(this).forEach(name => allPropsAndMethods.add(name));


    for (let prop of Array.from(allPropsAndMethods)) {
      if (typeof prop !== 'string' || !prop.includes("_")) continue;
      let [typePrefix, name] = prop.split("_", 2);
      if (!name) continue;

      // Case insensitive check for prefix, but keep original name casing for CSS/attributes
      switch (typePrefix.toLowerCase()) {
        case this._MagicPropCustomPrefix:
          if (this[prop] !== undefined) this.element.setAttribute(name.toLowerCase(), this[prop]);
          break;
        case this._MagicPropCssPrefix:
          if (this[prop] !== undefined) this.css(name, this[prop]); // name is CSS property
          break;
        case this._MagicMethodEventPrefix:
          if (typeof this[prop] === 'function') {
            this.element.addEventListener(name.toLowerCase(), (event) => this[prop](event));
          }
          break;
      }
    }
  }

  renderChildren() {
    // Children can be defined by subclass in defineChildren or passed via constructor
    let childrenToRender = this.defineChildren(); // Get children from subclass logic
    if (!Array.isArray(childrenToRender)) childrenToRender = [];

    // Clear existing DOM children if any (for re-renders, not initial)
    // this.element.innerHTML = ''; // Simple way, but loses event listeners on kept children.
    // Better: only remove children not in the new set, or for simple components, always rebuild.
    // For this app's structure, children are usually defined once and then updated.
    // If defineChildren is dynamic and changes list, more complex diffing needed for performance.
    // Here, assume children are stable or fully re-rendered.

    this.children = childrenToRender; // Update internal children array
    for (let child of this.children) {
      if (child && typeof child.render === 'function') {
        child.render(this); // Pass this component as parent
      } else if (child) {
        console.warn("Attempted to render child without a render method:", child, "Parent:", this);
      }
    }
  }

  defineChildren() { return this.children; } // Subclasses override to provide children
  defineTheme() { /* Subclasses override to apply theme-specific styles */ }

  renderTheme() {
    if (!this.element) return;
    this.defineTheme(); // Apply this component's theme styles
    if (this.skipChildrenTheme) return;
    (this.children || []).forEach(child => { // Ensure children array exists
        if (child && typeof child.renderTheme === 'function') {
            child.renderTheme();
        }
    });
  }

  renderCallback() { /* Subclasses override for post-render logic */ }
  id() { return this.accessibleBy || ""; } // Default ID from accessibleBy if set

  assignParent(parentComponent) {
    if (!parentComponent || !parentComponent.element || typeof parentComponent.element.appendChild !== 'function') {
      console.warn("Cannot assign to invalid parent:", parentComponent, "for child:", this);
      return;
    }
    this.parent = parentComponent;
    if (this.accessibleBy && this.parent) { // Make accessible via parent.childName
      this.parent[this.accessibleBy] = this;
    }
    if (this.element && !this.element.parentElement) { // Only append if not already in DOM
        parentComponent.element.appendChild(this.element);
    }
  }

  render(parentComponent = null) {
    this.create(); // Ensure DOM element exists
    const currentId = this.id();
    if (currentId && this.element.id !== currentId) this.element.id = currentId; // Set/update ID
    
    this.setValue(this.value); // Set innerHTML or value property
    this.registerMagicProps(); // Apply CSS, attributes, event listeners from magic props
    
    // Render children after this component's element is ready and props applied
    this.renderChildren();

    if (parentComponent) {
      this.assignParent(parentComponent);
    } else if (this.type.toLowerCase() !== 'body' && this.element && !this.element.parentElement && document.body) {
        // If no explicit parent and not body, append to document.body as a fallback root.
        // This should be rare if Body component is the root.
        // document.body.appendChild(this.element);
        // console.warn("Component rendered without parent, appending to body (check render flow):", this);
    }
    
    this.renderTheme(); // Apply theme-specific styles
    this.visible ? this.show() : this.hide(); // Set initial visibility
    this.renderCallback(); // Post-render logic
  }


  addChild(childComponent) {
    if (!childComponent || typeof childComponent.render !== 'function') {
      reportError("Attempted to add invalid child component.");
      return;
    }
    this.children.push(childComponent);
    if (this.element) { // If this parent component is already rendered
      childComponent.render(this); // Render the new child into this parent
    }
    // If parent not rendered, child will be rendered when parent.renderChildren is called.
  }

  css(styleProperty, value) { // styleProperty is camelCase e.g. 'backgroundColor'
    if (!this.element || styleProperty === undefined || value === undefined) return;

    // Allow theme keys for value, e.g., value = "bodyBgColor"
    const themeConfig = themeManager.getTheme();
    const themedValue = themeConfig[value]; // Is `value` a key in themeConfig?
    
    try {
        this.element.style[styleProperty] = themedValue !== undefined ? themedValue : value;
    } catch (e) {
        console.warn(`CSS Error: Failed to set style '${styleProperty}' to '${value}' (themed: '${themedValue}').`, e, this.element);
    }
  }

  setValue(val) {
    if (!this.element) this.create();
    this.value = val;
    if (this.element.hasOwnProperty('value')) { // For <input>, <textarea>, <select>
      this.element.value = val;
    } else { // For <div>, <span>, <p>, etc.
      this.element.innerHTML = val;
    }
  }
  getValue() {
    if (!this.element) return "";
    return this.element.value !== undefined ? this.element.value : this.element.innerHTML;
  }

  show() {
    this.visible = true;
    if (this.element) {
        // Determine appropriate display value (block, flex, inline-block, etc.)
        // This might need to be configurable per component type. Default to 'block'.
        let displayType = "block";
        if (this.type === 'span' || this.type === 'button' || this.type === 'input' || this.type === 'pixel') {
            // displayType = 'inline-block'; // Or rely on CSS file defaults
        }
        if (this.css_display) displayType = this.css_display; // Use specified css_display if exists
        this.css("display", displayType);
    }
  }
  hide() {
    this.visible = false;
    if (this.element) this.css("display", "none");
  }
  toggle() { this.visible ? this.hide() : this.show(); }
}
// ... Pixel and other UI Component classes will follow ...
// ... (Previous JavaScript: Component base class) ...

class Pixel extends Component {
  type = "pixel"; // Custom tag name, CSS should target this or a class

  // Default CSS properties applied via magic props (JS sets these on element.style)
  // css_position = "absolute"; // Set via JS
  // css_borderRight = "1px solid"; // Color and visibility via theme
  // css_borderTop = "1px solid";
  // css_textAlign = "center";
  // css_verticalAlign = "middle"; // For character centering
  // css_overflow = "hidden"; // Prevent char overflow if too large for cell

  constructor(row, col) {
    super({}); // Pass empty props, specific props set below
    this.row = row;
    this.col = col;
    this.cursorFlashInterval = null;
    this.selected = false; // If this pixel itself is part of a selected layer's display
    // Store scaled size for potential direct use if needed (e.g. export calculations)
    this.currentPixelHeight = 0;
    this.currentPixelWidth = 0;
  }

  id() { return Pixel.makeId(this.row, this.col); }
  is(otherPixel) { return otherPixel && this.id() === otherPixel.id(); }
  static makeId(r, c) { return `px@${r}/${c}`; }

  // --- Render States ---
  renderSelected() { // When this pixel is part of a selected layer
    this.selected = true;
    this.css("backgroundColor", "pixelSelectedBgColor");
    this.css("color", "pixelSelectedFgColor");
    this.css("borderRadius", "0px"); // Typically no radius for general selection
    this.applyGlowEffect();
  }
  renderUnselected() { // Default state
    this.selected = false;
    this.css("backgroundColor", "pixelNormalBgColor");
    this.css("color", "pixelNormalFgColor");
    this.css("borderRadius", "0px");
    this.applyGlowEffect();
  }
  renderResizable() { // When this pixel is a resize handle
    this.css("backgroundColor", "pixelResizeBgColor");
    this.css("borderRadius", "3px"); // Slightly rounded handles
    if (this.element) this.element.style.textShadow = 'none'; // No glow for handles
  }
  renderAreaSelected() { // Visual feedback for area selection rectangle
    this.css("backgroundColor", "areaSelectionBgColor");
    this.css("borderRadius", "0px");
    if (this.element) this.element.style.textShadow = 'none';
  }
  renderJoint() { // Pixel is a confirmed joint point
    this.css("backgroundColor", "pixelJointBgColor");
    this.css("borderRadius", "50%"); // Circle for joints
    if (this.element) this.element.style.textShadow = 'none';
  }
  renderJointNear() { // Mouse is near a potential joint point
    this.css("backgroundColor", "pixelJointNearBgColor");
    this.css("borderRadius", "50%");
    if (this.element) this.element.style.textShadow = 'none';
  }
  renderWasSelected() { // Revert to appropriate state after interaction
    this.stopCursor(); // Ensure cursor is off
    // Decide based on whether it's part of a currently selected layer
    const parentLayer = layerManager.getLayerByPixelId(this.id());
    if (parentLayer && parentLayer.isSelected()) {
        this.renderSelected();
    } else {
        this.renderUnselected();
    }
  }

  // --- Cursor Logic ---
  stopCursor() {
    if (this.cursorFlashInterval) clearInterval(this.cursorFlashInterval);
    this.cursorFlashInterval = null;
    if (this.element) this.renderNoCursorBorder(); // Restore normal border
  }
  renderNoCursorBorder() {
    this.css("borderRightColor", this.getBorderColor()); // Use themed grid color or transparent
    this.css("borderTopColor", this.getBorderColor());
    // For blinking cursor, could also use a ::after pseudo-element or a dedicated cursor div
  }
  renderCursorBorder() {
    this.css("borderRightColor", "pixelCursorColor"); // Highlight one border
    this.css("borderTopColor", this.getBorderColor());
  }
  startCursor() {
    this.stopCursor(); // Clear previous
    this.renderCursorBorder();
    const self = this;
    this.cursorFlashInterval = setInterval(() => {
      if (!self.element) { clearInterval(self.cursorFlashInterval); return; }
      // Check current border color to toggle
      // Comparing computedStyle is more robust but complex. Simple check for now.
      if (self.element.style.borderRightColor === (themeManager.getTheme().pixelCursorColor || Theme.Color.red)) {
        self.renderNoCursorBorder();
      } else {
        self.renderCursorBorder();
      }
    }, 600); // Blink speed
  }

  // --- Theming and Effects ---
  applyGlowEffect() {
    if (!this.element) return;
    const themeConfig = themeManager.getTheme();
    if (themeManager.glowEffectEnabled) {
      const glowColor = themeConfig.pixelGlowColor || themeConfig.pixelNormalFgColor || Theme.Color.glowDefault;
      // Subtle glow. Adjust blur and spread as needed.
      this.element.style.textShadow = `0 0 3px ${glowColor}, 0 0 5px ${glowColor}`;
    } else {
      this.element.style.textShadow = 'none';
    }
  }
  defineTheme() { // Called when global theme changes
    this.setBorderColor(); // Update border based on grid setting & theme
    // Re-apply current visual state with new theme colors
    // This needs to be more sophisticated, checking its logical state, not current style colors
    const parentLayer = layerManager.getLayerByPixelId(this.id());
    if (parentLayer && parentLayer.isSelected()) {
        this.renderSelected();
    } else {
        this.renderUnselected();
    }
    // Specific states like resize handle, joint, etc., are usually transient and
    // re-applied by interaction logic (e.g., selectMouseOverEvent).
    // If they need to persist visual theme changes, that logic should call renderResizable(), etc.
  }
  setBorderColor() {
    this.css("borderColor", this.getBorderColor());
  }
  getBorderColor() {
    return localStorage.getItem("grid") === "true" ? "gridColor" : "transparent";
  }

  // --- Core ---
  renderNormal() { // Reset to default visual state
    this.stopCursor();
    this.selected = false; // Logically no longer selected (as a pixel, layer selection is separate)
    this.renderUnselected(); // Sets bg/fg colors and glow state
    this.css("borderRadius", "0px"); // Ensure no residual radius
  }
  clear() { // Clear content and reset visuals
    this.setValue("");
    this.renderNormal();
  }

  // --- Positional Helpers ---
  isAbove(otherPixel) { return otherPixel && this.row < otherPixel.row; }
  isBelow(otherPixel) { return otherPixel && this.row > otherPixel.row; }
  isLeft(otherPixel) { return otherPixel && this.col < otherPixel.col; }
  isRight(otherPixel) { return otherPixel && this.col > otherPixel.col; }
  isNear(otherPixel, distance = 1) { // Manhattan distance
    if (!otherPixel) return false;
    return Math.abs(otherPixel.row - this.row) <= distance && Math.abs(otherPixel.col - this.col) <= distance;
  }
  isNearestTo(pixelArray) {
    if (!pixelArray || pixelArray.length === 0) return null;
    let closest = null;
    let minDist = Infinity;
    for (let p of pixelArray.filter(Boolean)) { // Filter out nulls
      let dist = Math.abs(p.row - this.row) + Math.abs(p.col - this.col);
      if (dist < minDist) {
        minDist = dist;
        closest = p;
      }
    }
    return closest;
  }

  // --- Sizing and Positioning (called by CanvasComponent.scale) ---
  scale(pixelSize, widthDivider) {
    if (!this.element) this.create(); // Ensure element exists for styling
    this.currentPixelHeight = pixelSize;
    this.currentPixelWidth = pixelSize * widthDivider;

    this.element.style.position = "absolute"; // Ensure position is absolute
    this.element.style.left = `${this.col * this.currentPixelWidth}px`;
    this.element.style.top = `${this.row * this.currentPixelHeight}px`;
    this.element.style.height = `${this.currentPixelHeight}px`;
    this.element.style.width = `${this.currentPixelWidth}px`;
    // Font size is typically set on the parent CanvasComponent and inherited.
    // If needed per pixel: this.element.style.fontSize = `${pixelSize * 0.8}px`;
    // Other fixed styles applied by magic props or CSS file
    this.element.style.textAlign = "center";
    this.element.style.verticalAlign = "middle"; // May need line-height for perfect centering
    this.element.style.lineHeight = `${this.currentPixelHeight}px`; // For vertical centering of text
    this.element.style.overflow = "hidden";
    this.element.style.borderRightStyle = "solid";
    this.element.style.borderTopStyle = "solid";
    this.element.style.borderRightWidth = "1px";
    this.element.style.borderTopWidth = "1px";
    this.setBorderColor(); // Apply themed border color
  }

  renderCallback() { // Initial render logic
    this.renderNormal(); // Set to default visual state
    // Initial scaling is done by CanvasComponent.scale() during its own renderCallback.
    // If a pixel is added dynamically *after* initial canvas scale, it would need explicit scaling.
  }
}

class CanvasComponent extends Component {
  accessibleBy = "canvasComponent"; // Parent (Body) can access via bodyComponent.canvasComponent
  type = "div"; // The main canvas area will be a div

  rowCount = 65;
  colCount = 225;
  pixelWidthDivider = 0.5; // Char cell width is half its height by default
  pixels = {}; // Map of Pixel.id() to Pixel object instances

  // Default CSS for the canvas container itself
  // css_userSelect = "none"; // Set via JS magic props
  // css_position = "absolute"; // Or relative if body uses flex/grid for layout
  // css_zIndex = "0";

  constructor(props) {
    super(props);
    // Ensure default CSS from class definition is applied if not in props
    this.css_userSelect = this.css_userSelect || "none";
    this.css_webkitUserSelect = this.css_webkitUserSelect || "none";
    this.css_position = this.css_position || "relative"; // Changed from absolute for simpler body layout
    this.css_overflow = "auto"; // Allow scrolling if canvas content exceeds viewport (after menus)
    this.css_margin = this.css_margin || "0"; // Will be set by body based on menus
    this.css_zIndex = this.css_zIndex || "0";
  }


  calcPixelSize() {
    if (this.colCount === 0 || this.pixelWidthDivider === 0) return 10; // Fallback
    // Calculate based on available width for the canvas div itself
    const availableWidth = this.element ? this.element.clientWidth : window.innerWidth;
    return Math.max(4, roundDown(availableWidth / this.colCount / this.pixelWidthDivider)); // Min size 4px
  }

  getPixelById(id) { return this.pixels[id] || null; }
  getPixelByRowCol(r, c) { return this.pixels[Pixel.makeId(r, c)] || null; }

  clear() { // Clear all characters from all pixel components
    for (let id in this.pixels) {
      if (this.pixels[id]) this.pixels[id].clear();
    }
  }

  setModeCursor() {
    if (!this.element) return;
    let cursorType = "default";
    if (modeMaster.hasOr("moving", "resizing")) cursorType = "move";
    else if (modeMaster.has("writing", "text")) cursorType = "text";
    else if (modeMaster.hasOr("draw", "drawing")) cursorType = "crosshair";
    else if (modeMaster.hasOr("erase", "erasing")) cursorType = "copy"; // Or a custom erase cursor
    this.element.style.cursor = cursorType;
  }
  setCursor(cursorName) { if (this.element) this.element.style.cursor = cursorName; }

  getCroppedRowsCols() { // [maxC, minC, maxR, minR, hasContent]
    let maxC = -1, minC = this.colCount, maxR = -1, minR = this.rowCount;
    let hasContent = false;
    for (let id in this.pixels) {
      const pixel = this.pixels[id];
      if (pixel && pixel.getValue() !== "" && pixel.getValue() !== " ") { // Consider space as empty for cropping
        hasContent = true;
        maxC = Math.max(maxC, pixel.col); minC = Math.min(minC, pixel.col);
        maxR = Math.max(maxR, pixel.row); minR = Math.min(minR, pixel.row);
      }
    }
    return hasContent ? [maxC, minC, maxR, minR, true] : [0, 0, 0, 0, false];
  }

  getDrawingDataForExport() {
    // ... (implementation from previous full script - unchanged)
    const [maxCol, minCol, maxRow, minRow, hasContent] = this.getCroppedRowsCols();
    if (!hasContent) {
        bodyComponent.informerComponent.report("Nothing to export.", "default");
        return null;
    }

    const charactersGrid = [];
    for (let r = minRow; r <= maxRow; r++) {
        const rowChars = [];
        for (let c = minCol; c <= maxCol; c++) {
            const pixel = this.getPixelByRowCol(r, c);
            rowChars.push(pixel ? pixel.getValue() || " " : " "); // Default to space if pixel missing
        }
        charactersGrid.push(rowChars);
    }
    
    const currentThemeConfig = themeManager.getTheme();
    const currentPixelSize = this.calcPixelSize(); // Get current dynamic pixel size

    const themeColors = {
        fg: currentThemeConfig.pixelNormalFgColor || Theme.Color.black,
        bg: currentThemeConfig.canvasBgColor || Theme.Color.white,
        font: currentThemeConfig.canvasFont || 'monospace',
        glowColor: themeManager.glowEffectEnabled ? (currentThemeConfig.pixelGlowColor || currentThemeConfig.pixelNormalFgColor) : null,
    };

    return {
        minRow, minCol, // Keep for reference if needed for absolute positioning in SVG
        widthInChars: maxCol - minCol + 1,
        heightInChars: maxRow - minRow + 1,
        charactersGrid,
        themeColors,
        pixelSize: currentPixelSize, // Use the dynamically calculated size
        pixelWidthDivider: this.pixelWidthDivider
    };
  }

  exportToPNG() {
    // ... (implementation from previous full script - unchanged)
    layerManager.switchModeCallback(); 
    const exportData = this.getDrawingDataForExport();
    if (!exportData) return;

    const { widthInChars, heightInChars, charactersGrid, themeColors, pixelSize, pixelWidthDivider } = exportData;

    // Use a base character height for export, can be fixed or based on current pixelSize
    const CHAR_EXPORT_HEIGHT = Math.max(16, pixelSize * 1.5); // Upscale for better PNG quality
    const CHAR_EXPORT_WIDTH = CHAR_EXPORT_HEIGHT * pixelWidthDivider;

    const tempCanvasEl = document.createElement('canvas');
    tempCanvasEl.width = widthInChars * CHAR_EXPORT_WIDTH;
    tempCanvasEl.height = heightInChars * CHAR_EXPORT_HEIGHT;
    const ctx = tempCanvasEl.getContext('2d');
    if (!ctx) {
        bodyComponent.informerComponent.report("Canvas context error for PNG export.", "bad");
        return;
    }

    ctx.fillStyle = themeColors.bg;
    ctx.fillRect(0, 0, tempCanvasEl.width, tempCanvasEl.height);

    const FONT_SIZE_PNG = CHAR_EXPORT_HEIGHT * 0.8; // Adjust for padding within cell
    ctx.font = `${FONT_SIZE_PNG}px ${themeColors.font}`;
    ctx.fillStyle = themeColors.fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (themeColors.glowColor) {
        ctx.shadowColor = themeColors.glowColor;
        ctx.shadowBlur = Math.max(2, FONT_SIZE_PNG * 0.1); // Glow size relative to font
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
    }
    
    for (let r = 0; r < heightInChars; r++) {
        for (let c = 0; c < widthInChars; c++) {
            const char = charactersGrid[r][c];
            if (char && char.trim() !== "") { // Draw non-empty characters
                const x = (c * CHAR_EXPORT_WIDTH) + (CHAR_EXPORT_WIDTH / 2);
                const y = (r * CHAR_EXPORT_HEIGHT) + (CHAR_EXPORT_HEIGHT / 2);
                ctx.fillText(char, x, y);
            }
        }
    }
    
    const dataURL = tempCanvasEl.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = 'cascii_drawing.png';
    link.href = dataURL;
    document.body.appendChild(link); // Required for FF
    link.click();
    document.body.removeChild(link);
    bodyComponent.informerComponent.report("Exported to PNG!", "good");
  }

  exportToSVG() {
    // ... (implementation from previous full script - unchanged)
    layerManager.switchModeCallback();
    const exportData = this.getDrawingDataForExport();
    if (!exportData) return;

    const { widthInChars, heightInChars, charactersGrid, themeColors, pixelSize, pixelWidthDivider } = exportData;

    const CHAR_SVG_HEIGHT = Math.max(10, pixelSize); // Use current pixelSize or a minimum
    const CHAR_SVG_WIDTH = CHAR_SVG_HEIGHT * pixelWidthDivider;
    const FONT_SIZE_SVG = CHAR_SVG_HEIGHT * 0.85; // Slightly larger for SVG text rendering

    const svgWidth = widthInChars * CHAR_SVG_WIDTH;
    const svgHeight = heightInChars * CHAR_SVG_HEIGHT;

    // XML-escape helper
    const escapeXML = (str) => str.replace(/[<>&"']/g, (match) => {
        switch (match) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '"': return '&quot;';
            case "'": return '&apos;';
        }
        return match;
    });

    let svgContent = `<svg width="${svgWidth}" height="${svgHeight}" xmlns="http://www.w3.org/2000/svg" style="background-color: ${escapeXML(themeColors.bg)}; font-family: ${escapeXML(themeColors.font)};">`;
    svgContent += `<style>
        .char { 
            font-size: ${FONT_SIZE_SVG}px; 
            fill: ${escapeXML(themeColors.fg)}; 
            text-anchor: middle; 
            dominant-baseline: middle; /* Better vertical centering */
        }
        ${themeColors.glowColor ? `.glow { filter: drop-shadow(0 0 1.5px ${escapeXML(themeColors.glowColor)}) drop-shadow(0 0 3px ${escapeXML(themeColors.glowColor)}); }` : ''}
    </style>`;

    for (let r = 0; r < heightInChars; r++) {
        for (let c = 0; c < widthInChars; c++) {
            const char = charactersGrid[r][c];
            if (char && char.trim() !== "") {
                const x = (c * CHAR_SVG_WIDTH) + (CHAR_SVG_WIDTH / 2);
                const y = (r * CHAR_SVG_HEIGHT) + (CHAR_SVG_HEIGHT / 2) + (FONT_SIZE_SVG*0.1); // Small adjustment for baseline often needed
                const classAttr = themeColors.glowColor ? "char glow" : "char";
                svgContent += `<text x="${x}" y="${y}" class="${classAttr}">${escapeXML(char)}</text>`;
            }
        }
    }
    svgContent += `</svg>`;

    const blob = new Blob([svgContent], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = 'cascii_drawing.svg';
    link.href = url;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    bodyComponent.informerComponent.report("Exported to SVG!", "good");
  }

  async exportToClipboard() {
    // ... (implementation from previous full script - unchanged)
    layerManager.switchModeCallback();
    var text = "";
    let [maxCol, minCol, maxRow, minRow, hasContent] = this.getCroppedRowsCols();
    
    if (!hasContent) {
        bodyComponent.informerComponent.report("Nothing to copy.", "default");
        return;
    }

    for (var r = minRow; r <= maxRow; r++) {
      var rowText = "";
      for (var c = minCol; c <= maxCol; c++) {
        let pixel = this.getPixelByRowCol(r, c);
        let pixelValue = pixel ? pixel.getValue() : " ";
        rowText += (pixelValue === "" ? " " : pixelValue);
      }
      text += `${rowText.trimEnd()}\n`; // Trim trailing spaces from each row
    }
    text = text.trimEnd(); // Remove last newline if any

    let shortKey = "";
    if (externalHookManager && typeof externalHookManager.getShortKeyUrl === 'function') {
        shortKey = await externalHookManager.getShortKeyUrl();
    }
    if (shortKey && shortKey.length > 0) {
      text += `\n\nEdit/view: ${shortKey}`;
    }

    try {
        await navigator.clipboard.writeText(text);
        bodyComponent.informerComponent.report("Copied to clipboard!", "good");
    } catch (err) {
        console.error('Clipboard API copy failed: ', err);
        // Fallback to execCommand (less reliable, deprecated)
        const textArea = document.createElement("textarea");
        textArea.value = text;
        textArea.style.position = "fixed"; textArea.style.opacity = "0";
        document.body.appendChild(textArea);
        textArea.focus(); textArea.select();
        try {
            document.execCommand('copy');
            bodyComponent.informerComponent.report("Copied (fallback method)!", "good");
        } catch (execErr) {
            console.error('Fallback copy failed: ', execErr);
            bodyComponent.informerComponent.report("Copy failed. Try manual copy.", "bad");
        }
        document.body.removeChild(textArea);
    }
  }

  defineTheme() { // Applies to the CanvasComponent's own div
    if (!this.element) return;
    const themeConf = themeManager.getTheme();
    this.css("backgroundColor", themeConf.canvasBgColor || Theme.Color.white);
    this.element.style.fontFamily = themeConf.canvasFont || "monospace"; // Direct style for inheritance
    // Font size for pixels is set during scale()
    // Child pixels will have their themes updated individually if renderTheme cascades
  }

  on_mouseDown(event) { // Belongs to CanvasComponent's element
    if (bodyComponent) bodyComponent.hidePopups();
    // Further mousedown logic (like starting selection) is handled by EventManager
    // based on the current modeMaster state.
  }

  defineChildren() { // Creates and returns Pixel component instances
    this.pixels = {}; // Clear existing pixel map
    const pixelComponents = [];
    for (var r = 0; r < this.rowCount; r++) {
      for (var c = 0; c < this.colCount; c++) {
        let pixel = new Pixel(r, c);
        this.pixels[pixel.id()] = pixel;
        pixelComponents.push(pixel);
      }
    }
    return pixelComponents; // These will be rendered by Component.renderChildren
  }

  scale() { // Rescales the canvas and all its pixels
    if (!this.element) return;
    let currentPixelSize = this.calcPixelSize();
    this.element.style.fontSize = `${currentPixelSize * 0.95}px`; // Base font size for pixels (slightly smaller for padding)
    // Canvas div itself doesn't need width/height if pixels are absolutely positioned relative to it.
    // Or, if canvas is positioned relative and pixels are absolute to it, set canvas size.
    // For current setup where body is block and menus are fixed, canvas can be block too.
    // Its effective size is determined by the extent of its absolutely positioned pixels.
    // Let's set its size explicitly to help with potential overflow scrolling.
    this.element.style.width = `${this.colCount * currentPixelSize * this.pixelWidthDivider}px`;
    this.element.style.height = `${this.rowCount * currentPixelSize}px`;


    for (let id in this.pixels) {
      if (this.pixels[id]) this.pixels[id].scale(currentPixelSize, this.pixelWidthDivider);
    }
  }

  renderCallback() { // After CanvasComponent itself is rendered
    this.scale(); // Initial scaling of all pixels
    modeMaster.registerCallback(() => this.setModeCursor());
    this.setModeCursor(); // Initial cursor
  }

  toggleGrid() {
    const gridCurrentlyEnabled = localStorage.getItem("grid") === "true";
    localStorage.setItem("grid", gridCurrentlyEnabled ? "false" : "true");
    // Force re-render of all pixels to update their border display
    // This can be done by calling renderTheme on each pixel, or re-rendering canvas.
    // A simpler way if themeManager.renderTheme() cascades properly:
    if (themeManager) themeManager.renderTheme();
    else { // Manual fallback
        Object.values(this.pixels).forEach(p => { if(p) p.defineTheme(); });
    }
  }
}
// ... PopupComponent and other UI components will follow ...
// ... (Previous JavaScript: Pixel and CanvasComponent classes) ...

class PopupComponent extends Component {
  // css_boxShadow, css_borderRadius, etc., set by magic props or direct style in JS
  isPopup = true;
  disableModes = false; // If true, modes are reset when popup shows

  constructor(props) {
    super(props);
    // Default popup styles if not overridden by props or specific component CSS
    this.css_position = this.css_position || "fixed"; // Popups usually fixed
    this.css_zIndex = this.css_zIndex || "1500"; // High z-index
    this.css_display = "none"; // Popups start hidden
    this.css_padding = this.css_padding || "20px";
    this.css_borderRadius = this.css_borderRadius || "10px";
    this.css_boxShadow = this.css_boxShadow || "0 4px 15px rgba(0,0,0,0.2)";
    // Centering:
    this.css_left = this.css_left || "50%";
    this.css_top = this.css_top || "50%";
    this.css_transform = this.css_transform || "translate(-50%, -50%)";
  }


  show() {
    if (bodyComponent) bodyComponent.hidePopups(); // Hide others
    if (this.disableModes && modeMaster) modeMaster.reset();
    super.show(); // Sets display: (original value, usually block or flex)
    this.element.style.opacity = "1"; // For fade-in if CSS transitions are set
  }

  hide() {
    if (this.element) this.element.style.opacity = "0"; // For fade-out
    // Add a small delay to allow fade-out transition before setting display:none
    setTimeout(() => {
        super.hide(); // Sets display: none
    }, 300); // Match CSS transition duration if any
  }

  renderCallback() {
    if (this.element) { // Ensure it's hidden initially
        this.element.style.display = "none";
        this.element.style.opacity = "0";
    }
  }

  defineTheme() {
    super.defineTheme(); // Call base, though it's empty
    const theme = themeManager.getTheme();
    this.css("backgroundColor", theme.bodyBgColor || Theme.Color.white);
    this.css("color", theme.bodyFgColor || Theme.Color.black);
    this.css("border", `1px solid ${theme.buttonBorderColor || Theme.Color.grey}`);
  }
}

class HelpComponent extends PopupComponent {
  accessibleBy = "helpComponent";
  // css_width, css_height, etc. are magic props from original single file
  // Set them directly or via constructor props if needed for this structure.

  constructor(props) {
    super({
        css_width: "clamp(300px, 80vw, 600px)", // Responsive width
        css_height: "clamp(300px, 70vh, 500px)",
        css_overflowY: "auto",
        // Centering is handled by PopupComponent defaults
        ...props // Allow overriding
    });
    this.value = `
      <div style='text-align: center;'><h2>Cascii Help</h2><h3>${VERSION}</h3></div>
      <p>CASCII is a web-based ASCII/Unicode diagram builder emphasizing portability and simplicity. 
      Use it to create text-based visuals for code, consoles, and more.</p>
      <h4>FAQ</h4>
      <dl>
        <dt>ASCII or Unicode?</dt>
        <dd>Unicode offers more characters but might display inconsistently. ASCII is more universal. Change modes in Settings.</dd>
        <dt>How do I export?</dt>
        <dd>Use "Copy Text", "PNG", or "SVG" from the top menu. Text exports are copied to your clipboard. For text, ensure your viewing environment uses a fixed-width font and doesn't wrap lines.</dd>
        <dt>What is Base64 I/O?</dt>
        <dd>Export/Import the internal drawing structure as Base64 text. This is useful for saving/sharing the editable drawing state without relying on server accounts.</dd>
        <dt>Why sign up?</dt>
        <dd>The hosted version at <a href="https://cascii.app" target="_blank" rel="noopener noreferrer">cascii.app</a> may offer account features for saving multiple drawings online. This local version saves to your browser.</dd>
        <dt>How do I contribute?</dt>
        <dd>Visit the <a href="https://github.com/casparwylie/cascii-core" target="_blank" rel="noopener noreferrer">GitHub repository</a>.</dd>
      </dl>
      <h4>Shortcuts</h4>
      <pre style="white-space: pre-wrap; background-color: rgba(0,0,0,0.05); padding: 10px; border-radius: 5px;">
ctrl/cmd + g      Group selected layers
ctrl/cmd + c      Copy selected layers
ctrl/cmd + v      Paste (text to layer, or as new text layer)
ctrl/cmd + z      Undo
ctrl/cmd + shift+z  Redo (or ctrl/cmd + y)
ctrl/cmd + a      Select all
shift + click     Multi-select layers
arrow keys        Move selected layer / Navigate text
backspace/delete  Delete layer / Character in text
escape            Unselect all / Exit text writing mode</pre>
    `;
  }
  // defineChildren is not needed as content is via this.value
}

class Base64IOComponent extends PopupComponent {
  // ... (Implementation from previous script part - should be correct now) ...
  disableModes = true;
  accessibleBy = "base64IOComponent";

  constructor(props) {
    super({
        css_width: "clamp(280px, 50vw, 350px)",
        css_height: "auto",
        css_paddingBottom: "20px",
         ...props
    });
  }

  defineChildren() {
    return [
      new Component({ type: "h2", css_textAlign: "center", css_marginTop: "0px", css_marginBottom: "20px", value: "Import/Export (Base64)" }),
      new ButtonComponent({ value: "<b>Export current drawing</b>", css_width: "calc(100% - 20px)", css_marginLeft: "10px", css_marginBottom: "15px", on_click: () => this.exportBase64ToClipboard() }),
      new Component({ type: "p", css_textAlign: "center", css_marginTop: "10px", css_marginBottom: "10px", value: "... OR ..." }),
      new InputComponent({ accessibleBy: "importContentComponent", prop_placeholder: "Paste Base64 here...", css_width: "calc(100% - 20px)", css_marginLeft: "10px", css_marginBottom: "10px" }),
      new ButtonComponent({ value: "Import from Base64", css_width: "calc(100% - 20px)", css_marginLeft: "10px", on_click: () => this.importFromBase64() }),
    ];
  }
  exportBase64ToClipboard() { /* ... same as before ... */
    layerManager.switchModeCallback();
    let jsonData = layerManager.encodeAll();
    try {
        let base64Data = btoa(unescape(encodeURIComponent(jsonData)));
        navigator.clipboard.writeText(base64Data)
          .then(() => bodyComponent.informerComponent.report("Base64 data copied!", "good"))
          .catch(err => {
            console.error("Base64 copy failed: ", err);
            bodyComponent.informerComponent.report("Base64 copy failed.", "bad");
          });
    } catch (e) {
        console.error("Error encoding to Base64:", e);
        bodyComponent.informerComponent.report("Base64 encoding error.", "bad");
    }
    this.hide();
  }
  importFromBase64() { /* ... same as before ... */
    let base64Data = this.importContentComponent ? this.importContentComponent.getValue() : "";
    if (!base64Data.trim()) {
        bodyComponent.informerComponent.report("No Base64 data provided.", "bad");
        return;
    }
    try {
      const jsonData = decodeURIComponent(escape(atob(base64Data)));
      if (layerManager.import(jsonData)) { // import now returns boolean
        // Success message handled by layerManager.import or here
        bodyComponent.informerComponent.report("Imported from Base64!", "good");
        if(this.importContentComponent) this.importContentComponent.setValue("");
        this.hide();
      }
      // else: failure message handled by layerManager.import
    } catch (e) {
      console.error("Base64 import error:", e);
      bodyComponent.informerComponent.report(`Base64 import failed: ${e.message.substring(0,100)}`, "bad");
    }
  }
}

class SettingsComponent extends PopupComponent {
  // ... (Implementation from previous script part - should be correct now) ...
  accessibleBy = "settingsComponent";
  charsetButtons = []; 
  themeButtons = [];  

  constructor(props) {
    super({
        css_width: "clamp(280px, 50vw, 350px)",
        css_height: "auto",
        css_paddingBottom: "20px",
        ...props
    });
    // Initialize buttons here for reliable access
    this.charsetButtons = [
        new ButtonComponent({ charsetId: "ascii", value: "ASCII", css_width: "calc(50% - 2px)", on_click: () => this.setCharset("ascii") }),
        new ButtonComponent({ charsetId: "unicode", value: "Unicode", css_width: "calc(50% - 2px)", on_click: () => this.setCharset("unicode") }),
    ];
    this.themeButtons = [
        new ButtonComponent({ themeId: "darkTheme", value: "Dark", css_width: "calc(25% - 2px)", on_click: () => this.setTheme("darkTheme") }),
        new ButtonComponent({ themeId: "lightTheme", value: "Light", css_width: "calc(25% - 2px)", on_click: () => this.setTheme("lightTheme") }),
        new ButtonComponent({ themeId: "consoleTheme", value: "Console", css_width: "calc(25% - 2px)", on_click: () => this.setTheme("consoleTheme") }),
        new ButtonComponent({ themeId: "systemTheme", value: "System", css_width: "calc(25% - 2px)", on_click: () => this.setTheme("systemTheme") }),
    ];
  }
  
  updateButtonSelections() { /* ... same as before ... */
    this.charsetButtons.forEach(b => b.selected = (charManager.getCharset() === b.charsetId));
    this.themeButtons.forEach(b => b.selected = (themeManager.defaultTheme === b.themeId)); // Compare against stored choice
    this.charsetButtons.forEach(b => {if(b.element) b.defineTheme()}); // Re-render to show selection
    this.themeButtons.forEach(b => {if(b.element) b.defineTheme()});

    const glowButton = this.children.find(c => c && c.accessibleBy === "glowToggleButton");
    if (glowButton && glowButton.element) {
        glowButton.setValue(themeManager.glowEffectEnabled ? "Glow: ON" : "Glow: OFF");
    }
  }
  show() { super.show(); this.updateButtonSelections(); }
  setCharset(id) { charManager.setCharset(id); layerManager.renderCharset(); this.updateButtonSelections(); }
  setTheme(id) { themeManager.setTheme(id); themeManager.renderTheme(); this.updateButtonSelections(); }
  toggleGlowSetting() { themeManager.toggleGlowEffect(); this.updateButtonSelections(); }

  defineChildren() { /* ... same as before, ensure buttons use this.charsetButtons etc ... */
    // Ensure selection state is current before buttons are defined as children for rendering
    this.updateButtonSelections(); 
    return [
      new Component({ type: "h2", css_textAlign: "center", css_marginTop: "0px", css_marginBottom: "20px", value: "Settings ⚙️" }),
      new Component({ type: "p", css_textAlign: "center", css_marginBottom: "5px", value: "Character Set" }),
      new Component({ css_display: "flex", css_gap: "4px", css_justifyContent: "center", css_marginBottom:"15px", children: this.charsetButtons }),
      new Component({ type: "p", css_textAlign: "center", css_marginBottom: "5px", value: "Theme" }),
      new Component({ css_display: "flex", css_gap: "4px", css_justifyContent: "center", css_marginBottom:"15px", children: this.themeButtons }),
      new Component({ type: "p", css_textAlign: "center", css_marginBottom: "5px", value: "Display" }),
      new ButtonComponent({ css_width: "calc(100% - 20px)", css_marginLeft:"10px", css_marginBottom:"5px", on_click: () => canvas.toggleGrid(), value: "Toggle Grid" }),
      new ButtonComponent({ accessibleBy: "glowToggleButton", css_width: "calc(100% - 20px)", css_marginLeft:"10px", on_click: () => this.toggleGlowSetting(), value: themeManager.glowEffectEnabled ? "Glow: ON" : "Glow: OFF" }),
    ];
  }
}

class InputComponent extends Component {
  // ... (Implementation from previous script part - unchanged) ...
  type = "input";
  constructor(props){
      super(props);
      this.css_height = this.css_height || "34px";
      this.css_border = this.css_border || "1px solid";
      this.css_borderRadius = this.css_borderRadius || "6px";
      this.css_fontFamily = this.css_fontFamily || "bodyFont";
      this.css_fontSize = this.css_fontSize || "14px";
      this.css_outline = "none";
      this.css_padding = this.css_padding || "0 10px";
      this.css_boxSizing = "border-box";
  }
  defineTheme() {
    const theme = themeManager.getTheme();
    this.css("backgroundColor", theme.buttonBgColor || Theme.Color.white);
    this.css("borderColor", theme.buttonBorderColor || Theme.Color.grey);
    this.css("color", theme.buttonFgColor || Theme.Color.black);
  }
  renderCallback() {
    super.renderCallback();
    if (this.prop_placeholder && this.element) {
        this.element.placeholder = this.prop_placeholder;
    }
  }
}

class ButtonComponent extends Component {
  // ... (Implementation from previous script part - largely unchanged, ensure defineTheme reflects selection) ...
  type = "button";
  selected = false; 

  constructor(props) {
    super(props);
    if (props && props.selectByDefault !== undefined) this.selected = props.selectByDefault;
    // Default styles - these are applied if not overridden by magic props from instance
    this.css_fontFamily = this.css_fontFamily || "monospace";
    this.css_fontSize = this.css_fontSize || "12px";
    this.css_padding = this.css_padding || "8px 12px";
    this.css_borderRadius = this.css_borderRadius || "6px";
    this.css_height = this.css_height || "auto";
    this.css_border = this.css_border || "1px solid";
    this.css_userSelect = "none";
    this.css_cursor = "pointer";
    this.css_transition = "background-color 0.1s ease, box-shadow 0.1s ease";
    this.css_margin = this.css_margin || "2px"; // Small default margin
  }

  defineTheme() {
    const theme = themeManager.getTheme();
    if (this.selected) {
      this.css("backgroundColor", theme.buttonSelectedBgColor || Theme.Color.blue);
      // Retain original buttonFgColor or define a specific one for selected state
      this.css("color", theme.buttonFgColor || Theme.Color.white); 
    } else {
      this.css("backgroundColor", theme.buttonBgColor || Theme.Color.lightGrey);
      this.css("color", theme.buttonFgColor || Theme.Color.black);
    }
    this.css("borderColor", theme.buttonBorderColor || Theme.Color.grey);
  }
  unselect() { this.selected = false; if (this.element) this.defineTheme(); }
  select() { this.selected = true; if (this.element) this.defineTheme(); }
  renderCallback() { if (this.element) this.defineTheme(); } // Apply theme on initial render
  
  on_mouseDown(event) { 
    if (this.element) this.css("backgroundColor", themeManager.getTheme().buttonClickBgColor || Theme.Color.darkBlue);
  }
  on_mouseUp(event) { 
    if (this.element) this.defineTheme(); // Revert to selected or normal state
  }
  on_mouseOut(event) { // If mouse leaves while pressed
    if (this.element && this.element.style.backgroundColor === (themeManager.getTheme().buttonClickBgColor)){
         this.defineTheme(); 
    }
  }
}

// MenuButtonComponent, ModeMenuButtonComponent, MenuButtonLeftComponent, MenuComponent, ModeMenuComponent
// MainMenuComponent, LeftMenuComponent, CanvasDumpComponent, InformerComponent, Body
// ... (These component implementations are largely the same as in the previous complete script)
// For brevity here, I'll skip repeating their full code, assuming they are correct from before.
// The key is their constructor props and how they define children.
// Ensure their `defineTheme` methods correctly use `themeManager.getTheme()`.

// --- Re-inserting simplified versions or stubs for menu components for completeness ---
// NOTE: Replace these with the full implementations from the previous "single file" version,
// adapting constructors if necessary for props-based CSS overrides.

class MenuButtonComponent extends ButtonComponent {
    constructor(props){ super(props); this.css_marginTop = this.css_marginTop || "5px"; this.css_marginBottom = this.css_marginBottom || "5px"; }
}
class ModeMenuButtonComponent extends MenuButtonComponent {
  constructor(icon, name, showCondition, setModes, activeModes, callback = () => {}) {
    super({}); 
    this.icon = icon; this.name = name;
    this.value = `<span style="font-size: 1em; margin-right: 5px; vertical-align: middle;">${icon}</span><span style="vertical-align: middle;">${name}</span>`;
    this.showCondition = modeMaster.makeFunc(showCondition || []);
    this.callback = callback;
    this.setModes = modeMaster.makeFunc(setModes || []);
    this.activeModesCondition = (activeModes && activeModes.length) ? modeMaster.makeFunc(activeModes) : () => false;
    // Add on_click to the prototype or instance if not handled by magic props correctly
    this.element_on_click = (event) => { // Using element_on_click for magic prop
        this.setModes();
        this.callback(event);
    };
  }
  defineChildren() { return []; }
  isActive() { return this.activeModesCondition(); }
  refresh() { this.isActive() ? this.select() : this.unselect(); this.showCondition() ? super.show() : super.hide(); }
}
class MenuButtonLeftComponent extends ModeMenuButtonComponent {
    constructor(icon, name, sc, sm, am, cb) { super(icon,name,sc,sm,am,cb); this.css_width="calc(100% - 4px)"; this.css_textAlign="left";this.css_paddingLeft="10px";}
}
class MenuComponent extends Component { buttons = []; defineChildren() { return this.buttons; } }
class ModeMenuComponent extends MenuComponent {
  refresh() { this.buttons.forEach(b => { if (b && typeof b.refresh === 'function') b.refresh(); }); }
  renderCallback() { super.renderCallback(); modeMaster.registerCallback(() => this.refresh()); this.refresh(); }
}

// MainMenuComponent (ensure its constructor defines this.buttons correctly as before)
class MainMenuComponent extends ModeMenuComponent {
  accessibleBy = "mainMenuComponent";
  constructor(props) {
    super(props);
    this.css_position = "fixed"; this.css_top="0"; this.css_left="0"; this.css_width="100%";
    this.css_display="flex"; this.css_flexWrap="wrap"; this.css_justifyContent="center";
    this.css_padding="5px"; this.css_gap="3px"; this.css_zIndex="1000"; this.css_height="auto";
    this.buttons = [ /* ... Copied from the previous working script ... */ 
        new ModeMenuButtonComponent("➤","Select",[],[modeMaster.reset, "select"],[modeMaster.hasOr, "selected", "select"],() => layerManager.switchModeCallback()),
        new ModeMenuButtonComponent("◻","Square",[],[modeMaster.reset, "draw", "square"],[modeMaster.isDrawyMode, "square"],() => layerManager.switchModeCallback()),
        new ModeMenuButtonComponent("◯","Circle",[],[modeMaster.reset, "draw", "circle"],[modeMaster.isDrawyMode, "circle"],() => layerManager.switchModeCallback()),
        new ModeMenuButtonComponent("t","Text",[],[modeMaster.reset, "draw", "text"],[modeMaster.isDrawyMode, "text"],() => layerManager.switchModeCallback()),
        new ModeMenuButtonComponent("/","Line",[],[modeMaster.reset, "draw", "line", "free-line"],[modeMaster.isDrawyMode, "free-line"],() => layerManager.switchModeCallback()),
        new ModeMenuButtonComponent("_|","Step",[],[modeMaster.reset, "draw", "line", "step-line"],[modeMaster.isDrawyMode, "step-line"],() => layerManager.switchModeCallback()),
        new ModeMenuButtonComponent("_|‾","Switch",[],[modeMaster.reset, "draw", "line", "switch-line"],[modeMaster.isDrawyMode, "switch-line"],() => layerManager.switchModeCallback()),
        new ModeMenuButtonComponent("◇","Diamond",[],[modeMaster.reset, "draw", "diamond"],[modeMaster.isDrawyMode, "diamond"],() => layerManager.switchModeCallback()),
        new ModeMenuButtonComponent("᎒᎒᎒","Table",[],[modeMaster.reset, "draw", "table"],[modeMaster.isDrawyMode, "table"],() => layerManager.switchModeCallback()),
        new ModeMenuButtonComponent("∿","Free",[],[modeMaster.reset, "draw", "free"],[modeMaster.isDrawyMode, "free"],() => FreeLayer.startFreeDraw()),
        new ModeMenuButtonComponent("⌫","Erase",[],[modeMaster.reset, "erase", "ebutton"],[modeMaster.hasOr, "erasing", "erase"],() => layerManager.switchModeCallback()),
        new ModeMenuButtonComponent("↺", "Undo", [], [], [], event => layerManager.undoEvent(event)),
        new ModeMenuButtonComponent("↻", "Redo", [], [], [], event => layerManager.redoEvent(event)),
        new ModeMenuButtonComponent("🗑️", "Restart", [], [], [], () => { if(confirm("Restart? Unsaved work will be lost.")) layerManager.refresh(() => layerManager.emptyEvent()); }),
        new ModeMenuButtonComponent("📋", "<b>Copy Text</b>", [], [], [], () => canvas.exportToClipboard()),
        new ModeMenuButtonComponent("🖼️", "<b>PNG</b>", [], [], [], () => canvas.exportToPNG()),
        new ModeMenuButtonComponent("✒️", "<b>SVG</b>", [], [], [], () => canvas.exportToSVG()),
        new ModeMenuButtonComponent("⇔", "<b>Base64 I/O</b>", [], [], [], () => bodyComponent.base64IOComponent.toggle()),
        new ModeMenuButtonComponent("⚙️", "<b>Settings</b>", [], [], [], () => bodyComponent.settingsComponent.toggle()),
        new ModeMenuButtonComponent("❓", "<b>Help</b>", [], [], [], () => bodyComponent.helpComponent.toggle()),
    ];
  }
  defineTheme() { super.defineTheme(); const t = themeManager.getTheme(); this.css("backgroundColor", t.bodyBgColor); this.css("boxShadow", `0 1px 3px ${t.nearBlack || 'rgba(0,0,0,0.1)'}`); }
}

// LeftMenuComponent (ensure its constructor defines this.buttons and drawFreeButtons correctly)
class LeftMenuComponent extends ModeMenuComponent {
  accessibleBy = "leftMenuComponent";
  drawFreeOptions = [ ["_lines", "-|", "Lines"], ["█", "█", "Fill"], ["x", "x", "X"], ["*", "*", "*"], [".", ".", "."], ["+", "+", "+"], ["•", "•", "•"] ];
  constructor(props) {
    super(props);
    this.css_position="fixed"; this.css_left="5px"; this.css_top=(props && props.css_top) || "65px"; // Default top
    this.css_width="145px"; this.css_height=`calc(100vh - ${(parseInt(this.css_top) + 10)}px)`;
    this.css_overflowY="auto"; this.css_padding="5px 0"; this.css_zIndex="900";
    this.buttons = [ /* ... Copied from previous working script ... */ 
        new MenuButtonLeftComponent("⧉", "Copy", [modeMaster.has, "selected"], [], [], e => layerManager.copySelectedLayersEvent(e)),
        new MenuButtonLeftComponent("⧓", "Group", [modeMaster.has, "multi-select", "selected"], [], [], e => layerManager.groupSelectedLayersEvent(e)),
        new MenuButtonLeftComponent("⧎", "Ungroup", [modeMaster.has, "multi-select", "selected"], [], [], e => layerManager.ungroupSelectedLayersEvent(e)),
        new MenuButtonLeftComponent("✕","Delete",[modeMaster.has, "selected"],[modeMaster.reset, "select"],[],e => layerManager.deleteLayersEvent(e)),
        new MenuButtonLeftComponent("↑", "Forward", [modeMaster.has, "selected"], [], [], e => layerManager.bringForwardEvent(e)),
        new MenuButtonLeftComponent("↓", "Backwards", [modeMaster.has, "selected"], [], [], e => layerManager.sendBackwardsEvent(e)),
        new MenuButtonLeftComponent("⇑", "Front", [modeMaster.has, "selected"], [], [], e => layerManager.bringToFrontEvent(e)),
        new MenuButtonLeftComponent("⇓", "Back", [modeMaster.has, "selected"], [], [], e => layerManager.sendToBackEvent(e)),
        new MenuButtonLeftComponent("⏴", "Arrow L", [modeMaster.has, "selected", "line"], [], [], () => layerManager.redrawLinesEvent("left")),
        new MenuButtonLeftComponent("⏵", "Arrow R", [modeMaster.has, "selected", "line"], [], [], () => layerManager.redrawLinesEvent("right")),
        new MenuButtonLeftComponent("┈", "Dotted", [modeMaster.has, "selected", "line-based"], [], [], () => layerManager.redrawLineBasedEvent("dotted")),
        new MenuButtonLeftComponent("┉", "Dashed", [modeMaster.has, "selected", "line-based"], [], [], () => layerManager.redrawLineBasedEvent("dashed")),
        new MenuButtonLeftComponent("─", "Solid", [modeMaster.has, "selected", "line-based"], [], [], () => layerManager.redrawLineBasedEvent("solid-thin")),
        new MenuButtonLeftComponent("━", "Solid Bold", [modeMaster.has, "selected", "line-based"], [], [], () => layerManager.redrawLineBasedEvent("solid-bold")),
    ].concat(this.drawFreeButtons());
  }
  drawFreeButtons() { /* ... same as before ... */
    let btns = [];
    for (let [char, icon, name] of this.drawFreeOptions) {
      btns.push(new MenuButtonLeftComponent(icon, name, [modeMaster.has, "draw", "free"], [], [() => FreeLayer.freeChar === char && modeMaster.has("draw", "free")], () => { FreeLayer.setFreeChar(char); this.refresh(); }));
    } return btns;
  }
  defineTheme() { super.defineTheme(); const t = themeManager.getTheme(); this.css("backgroundColor", t.bodyBgColor); this.css("borderRight", `1px solid ${t.buttonBorderColor || Theme.Color.grey}`); }
  refresh(){ super.refresh(); if(this.element) this.element.style.display = this.buttons.some(b=>b.visible) ? 'block' : 'none';}
}

class CanvasDumpComponent extends Component { /* ... Same as before ... */
  accessibleBy = "canvasDumpComponent"; type = "div";
  constructor(props){ super(props); this.css_position="absolute";this.css_left="-99999px";this.css_opacity="0"; this.css_pointerEvents="none"; this.css_whiteSpace="pre";}
  defineTheme(){ const t=themeManager.getTheme(); this.css("fontFamily", t.canvasFont); this.css("backgroundColor",t.canvasBgColor);this.css("color",t.pixelNormalFgColor); }
}

class InformerComponent extends Component { /* ... Same as before, ensure hideTimeout is managed ... */
  accessibleBy = "informerComponent"; hideTimeout = null;
  constructor(props){
      super(props);
      this.css_position="fixed"; this.css_bottom="20px"; this.css_left="50%"; this.css_transform="translateX(-50%) translateY(120%)"; // Start offscreen
      this.css_width="auto"; this.css_maxWidth="50%"; this.css_minWidth="250px"; this.css_padding="12px 20px";
      this.css_borderRadius="8px"; this.css_boxShadow="0 2px 10px rgba(0,0,0,0.2)"; this.css_fontSize="14px";
      this.css_textAlign="center"; this.css_zIndex="2000"; this.css_transition="opacity .3s ease, transform .3s ease";
  }
  defineChildren() { return [ new Component({ accessibleBy: "moodCharComponent", type: "span", css_fontSize: "1.2em", css_marginRight: "10px" }), new Component({ accessibleBy: "messageComponent", type: "span" }) ]; }
  report(message, mood="default", time=null){ /* ... same as before, ensure moodCharComponent.css and messageComponent.css are called ... */
    if (time === null) time = Math.max(2500, message.length * 120);
    if (this.hideTimeout) clearTimeout(this.hideTimeout);
    let moodChar = "ℹ️"; let bgKey = "informerDefaultBgColor"; let fgKey = "informerDefaultFgColor";
    const theme = themeManager.getTheme();
    switch(mood){case "good": moodChar="✓"; bgKey=theme.informerGoodBgColor; fgKey=theme.informerGoodFgColor; break; case "bad": moodChar="✕"; bgKey=theme.informerBadBgColor; fgKey=theme.informerBadFgColor; break; case "loading": moodChar="⏳"; time = -1; break;}
    this.css("backgroundColor", bgKey);
    if(this.moodCharComponent) {this.moodCharComponent.setValue(moodChar); this.moodCharComponent.css("color", fgKey);}
    if(this.messageComponent) {this.messageComponent.setValue(message); this.messageComponent.css("color", fgKey);}
    this.element.style.opacity="1"; this.element.style.transform="translateX(-50%) translateY(0)"; super.show();
    if(time !== -1) this.hideTimeout = setTimeout(() => this.hide(), time);
  }
  hide() { if(!this.element) return; this.element.style.opacity="0"; this.element.style.transform="translateX(-50%) translateY(120%)"; setTimeout(()=>super.hide(),300); }
  loading(){this.report("Loading...","loading");} loadingFinish(){this.hide();}
  renderCallback(){ if(this.element) {this.element.style.opacity="0"; this.element.style.display="none";} }
}


// --- Body Component (App Root) ---
class Body extends Component {
  type = "body"; // Targets document.body

  create() { // Override: Don't create new body, use existing
    this.element = document.body;
    // Apply some base styles directly if not handled by CSS file
    this.element.style.margin = "0";
    this.element.style.padding = "0";
    this.element.style.height = "100vh";
    this.element.style.overflow = "hidden"; // Managed by body
    this.element.style.position = "relative"; // For absolute positioning of children like canvas
  }
  assignParent() { /* Body has no component parent */ }

  defineChildren() {
    const mainMenu = new MainMenuComponent();
    const approxMainMenuHeight = 65; // Estimate in px for positioning others
    const leftMenu = new LeftMenuComponent({ css_top: `${approxMainMenuHeight}px`});
    const leftMenuWidth = 150; // Estimate for canvas margin

    const canvasComp = new CanvasComponent({
        // Canvas takes space after fixed menus
        css_position: "absolute", // Position relative to body
        css_top: `${approxMainMenuHeight}px`,
        css_left: `${leftMenuWidth}px`,
        css_width: `calc(100% - ${leftMenuWidth}px)`,
        css_height: `calc(100vh - ${approxMainMenuHeight}px)`,
        css_overflow: "hidden" // Important for pixel canvas behavior
    });

    return [
      mainMenu, leftMenu, canvasComp,
      new InformerComponent(), new SettingsComponent(), new HelpComponent(),
      new Base64IOComponent(), new CanvasDumpComponent(),
    ];
  }

  hidePopups() {
    if(modeMaster) modeMaster.setDefault();
    (this.children || []).forEach(child => {
      if (child && child.isPopup && child.visible) child.hide();
    });
  }

  defineTheme() { // Styles for the <body> tag itself
    const theme = themeManager.getTheme();
    this.css("backgroundColor", theme.bodyBgColor || Theme.Color.white);
    this.css("color", theme.bodyFgColor || Theme.Color.black);
    this.css("fontFamily", theme.bodyFont || "monospace");
  }
}

// --- Main Initialization Logic ---
function handleFirstVisit() {
  if (firstVisit && bodyComponent && bodyComponent.helpComponent) {
    bodyComponent.helpComponent.show();
    let shownTip = false;
    const tipCallback = () => {
      if (modeMaster && modeMaster.has("draw") && !shownTip && bodyComponent.informerComponent) {
        bodyComponent.informerComponent.report("Click and drag to start drawing!", "default");
        shownTip = true;
        if (modeMaster.callbacks) modeMaster.callbacks = modeMaster.callbacks.filter(cb => cb !== tipCallback);
      }
    };
    if (modeMaster) modeMaster.registerCallback(tipCallback);
  }
  localStorage.setItem("visited", "true");
}

function initManagers() {
  themeManager = new ThemeManager();
  layerManager = new LayerManager(); // Needs ThemeManager if layers use theme colors in constructor
  modeMaster = new ModeMaster();
  areaSelectManager = new AreaSelectManager();
  charManager = new CharManager(); // Needs ThemeManager if chars depend on theme (not currently)
  eventManager = new EventManager(); // EventDef uses modeMaster, so modeMaster must be ready
  externalHookManager = new BaseExternalHookManager();
}

function main() {
  if (isTablet()) {
    mobilePage();
    return;
  }

  initManagers();

  bodyComponent = new Body(); // Creates Body component targeting document.body
  bodyComponent.render();    // Renders all children into the actual document.body

  // Assign global 'canvas' to the canvasComponent instance created by Body
  if (bodyComponent && bodyComponent.canvasComponent) {
    canvas = bodyComponent.canvasComponent;
  } else {
    console.error("CRITICAL: Canvas component not found after body render.");
    return; // Cannot proceed without canvas
  }

  // Setup event listeners on the now-existing elements
  if (canvas && canvas.element && document) {
    eventManager.assignAll({
      window: window,
      document: document,
      canvas: canvas.element, // Pass the DOM element of the canvas component
    });
  } else {
      console.error("CRITICAL: Cannot assign events. Canvas or document not ready.");
  }

  if (layerManager) layerManager.importFromLocalStorage();
  handleFirstVisit();

  window.dispatchEvent(new Event("casciiLoaded"));
  console.log("CASCII Enhanced Initialized - Separated Files Version");
}

// Defer main execution until DOM is fully loaded and parsed
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
} else {
    main(); // DOMContentLoaded has already fired
}
// Note: window.onload fires later, after all resources (images, etc.)
// DOMContentLoaded is generally preferred for starting JS app logic.
// Changed from window.onload to DOMContentLoaded for faster perceived startup.
// ... (Previous JavaScript: Pixel and CanvasComponent classes from Part 8) ...

class PopupComponent extends Component {
  isPopup = true;
  disableModes = false;

  constructor(props) {
    super(props);
    this.css_position = this.css_position || "fixed";
    this.css_zIndex = this.css_zIndex || "1500";
    this.css_display = "none";
    this.css_padding = this.css_padding || "20px";
    this.css_borderRadius = this.css_borderRadius || "10px";
    this.css_boxShadow = this.css_boxShadow || "0 4px 15px rgba(0,0,0,0.2)";
    this.css_left = this.css_left || "50%";
    this.css_top = this.css_top || "50%";
    this.css_transform = this.css_transform || "translate(-50%, -50%)";
  }

  show() {
    if (bodyComponent) bodyComponent.hidePopups();
    if (this.disableModes && modeMaster) modeMaster.reset();
    super.show();
    if(this.element) this.element.style.opacity = "1";
  }

  hide() {
    if (this.element) this.element.style.opacity = "0";
    setTimeout(() => {
        super.hide();
    }, 300);
  }

  renderCallback() {
    if (this.element) {
        this.element.style.display = "none";
        this.element.style.opacity = "0";
    }
  }

  defineTheme() {
    super.defineTheme();
    const theme = themeManager.getTheme();
    this.css("backgroundColor", theme.bodyBgColor || Theme.Color.white);
    this.css("color", theme.bodyFgColor || Theme.Color.black);
    this.css("border", `1px solid ${theme.buttonBorderColor || Theme.Color.grey}`);
  }
}

class HelpComponent extends PopupComponent {
  accessibleBy = "helpComponent";

  constructor(props) {
    super({
        css_width: "clamp(300px, 80vw, 600px)",
        css_height: "clamp(300px, 70vh, 500px)",
        css_overflowY: "auto",
        ...props
    });
    this.value = `
      <div style='text-align: center;'><h2>Cascii Help</h2><h3>${VERSION}</h3></div>
      <p>CASCII is a web-based ASCII/Unicode diagram builder emphasizing portability and simplicity. 
      Use it to create text-based visuals for code, consoles, and more.</p>
      <h4>FAQ</h4>
      <dl>
        <dt>ASCII or Unicode?</dt>
        <dd>Unicode offers more characters but might display inconsistently. ASCII is more universal. Change modes in Settings.</dd>
        <dt>How do I export?</dt>
        <dd>Use "Copy Text", "PNG", or "SVG" from the top menu. Text exports are copied to your clipboard. For text, ensure your viewing environment uses a fixed-width font and doesn't wrap lines.</dd>
        <dt>What is Base64 I/O?</dt>
        <dd>Export/Import the internal drawing structure as Base64 text. This is useful for saving/sharing the editable drawing state without relying on server accounts.</dd>
        <dt>Why sign up?</dt>
        <dd>The hosted version at <a href="https://cascii.app" target="_blank" rel="noopener noreferrer">cascii.app</a> may offer account features for saving multiple drawings online. This local version saves to your browser.</dd>
        <dt>How do I contribute?</dt>
        <dd>Visit the <a href="https://github.com/casparwylie/cascii-core" target="_blank" rel="noopener noreferrer">GitHub repository</a>.</dd>
      </dl>
      <h4>Shortcuts</h4>
      <pre style="white-space: pre-wrap; background-color: rgba(0,0,0,0.05); padding: 10px; border-radius: 5px;">
ctrl/cmd + g      Group selected layers
ctrl/cmd + c      Copy selected layers
ctrl/cmd + v      Paste (text to layer, or as new text layer)
ctrl/cmd + z      Undo
ctrl/cmd + shift+z  Redo (or ctrl/cmd + y)
ctrl/cmd + a      Select all
shift + click     Multi-select layers
arrow keys        Move selected layer / Navigate text
backspace/delete  Delete layer / Character in text
escape            Unselect all / Exit text writing mode</pre>
    `;
  }
}

class Base64IOComponent extends PopupComponent {
  disableModes = true;
  accessibleBy = "base64IOComponent";

  constructor(props) {
    super({
        css_width: "clamp(280px, 50vw, 350px)",
        css_height: "auto",
        css_paddingBottom: "20px",
         ...props
    });
  }

  defineChildren() {
    return [
      new Component({ type: "h2", css_textAlign: "center", css_marginTop: "0px", css_marginBottom: "20px", value: "Import/Export (Base64)" }),
      new ButtonComponent({ value: "<b>Export current drawing</b>", css_width: "calc(100% - 20px)", css_marginLeft: "10px", css_marginBottom: "15px", on_click: () => this.exportBase64ToClipboard() }),
      new Component({ type: "p", css_textAlign: "center", css_marginTop: "10px", css_marginBottom: "10px", value: "... OR ..." }),
      new InputComponent({ accessibleBy: "importContentComponent", prop_placeholder: "Paste Base64 here...", css_width: "calc(100% - 20px)", css_marginLeft: "10px", css_marginBottom: "10px" }),
      new ButtonComponent({ value: "Import from Base64", css_width: "calc(100% - 20px)", css_marginLeft: "10px", on_click: () => this.importFromBase64() }),
    ];
  }
  exportBase64ToClipboard() {
    layerManager.switchModeCallback();
    let jsonData = layerManager.encodeAll();
    try {
        let base64Data = btoa(unescape(encodeURIComponent(jsonData)));
        navigator.clipboard.writeText(base64Data)
          .then(() => bodyComponent.informerComponent.report("Base64 data copied!", "good"))
          .catch(err => {
            console.error("Base64 copy failed: ", err);
            bodyComponent.informerComponent.report("Base64 copy failed.", "bad");
          });
    } catch (e) {
        console.error("Error encoding to Base64:", e);
        bodyComponent.informerComponent.report("Base64 encoding error.", "bad");
    }
    this.hide();
  }
  importFromBase64() {
    let base64Data = this.importContentComponent ? this.importContentComponent.getValue() : "";
    if (!base64Data.trim()) {
        bodyComponent.informerComponent.report("No Base64 data provided.", "bad");
        return;
    }
    try {
      const jsonData = decodeURIComponent(escape(atob(base64Data)));
      if (layerManager.import(jsonData)) {
        bodyComponent.informerComponent.report("Imported from Base64!", "good");
        if(this.importContentComponent) this.importContentComponent.setValue("");
        this.hide();
      }
    } catch (e) {
      console.error("Base64 import error:", e);
      bodyComponent.informerComponent.report(`Base64 import failed: ${e.message.substring(0,100)}`, "bad");
    }
  }
}

class SettingsComponent extends PopupComponent {
  accessibleBy = "settingsComponent";
  charsetButtons = []; 
  themeButtons = [];  

  constructor(props) {
    super({
        css_width: "clamp(280px, 50vw, 350px)",
        css_height: "auto",
        css_paddingBottom: "20px",
        ...props
    });
    this.charsetButtons = [
        new ButtonComponent({ charsetId: "ascii", value: "ASCII", css_width: "calc(50% - 2px)", on_click: () => this.setCharset("ascii") }),
        new ButtonComponent({ charsetId: "unicode", value: "Unicode", css_width: "calc(50% - 2px)", on_click: () => this.setCharset("unicode") }),
    ];
    this.themeButtons = [
        new ButtonComponent({ themeId: "darkTheme", value: "Dark", css_width: "calc(25% - 3px)", on_click: () => this.setTheme("darkTheme") }), // Adjusted width for 4 buttons
        new ButtonComponent({ themeId: "lightTheme", value: "Light", css_width: "calc(25% - 3px)", on_click: () => this.setTheme("lightTheme") }),
        new ButtonComponent({ themeId: "consoleTheme", value: "Console", css_width: "calc(25% - 3px)", on_click: () => this.setTheme("consoleTheme") }),
        new ButtonComponent({ themeId: "systemTheme", value: "System", css_width: "calc(25% - 3px)", on_click: () => this.setTheme("systemTheme") }),
    ];
  }
  
  updateButtonSelections() {
    this.charsetButtons.forEach(b => { if(b) b.selected = (charManager.getCharset() === b.charsetId); });
    this.themeButtons.forEach(b => { if(b) b.selected = (themeManager.defaultTheme === b.themeId); });
    this.charsetButtons.forEach(b => {if(b && b.element) b.defineTheme()});
    this.themeButtons.forEach(b => {if(b && b.element) b.defineTheme()});

    const glowButton = this.children.find(c => c && c.accessibleBy === "glowToggleButton"); // Assumes children are populated
    if (glowButton && glowButton.element) {
        glowButton.setValue(themeManager.glowEffectEnabled ? "Glow: ON" : "Glow: OFF");
    }
  }
  show() { super.show(); this.updateButtonSelections(); } // Update on show
  setCharset(id) { charManager.setCharset(id); layerManager.renderCharset(); this.updateButtonSelections(); }
  setTheme(id) { themeManager.setTheme(id); themeManager.renderTheme(); this.updateButtonSelections(); }
  toggleGlowSetting() { themeManager.toggleGlowEffect(); this.updateButtonSelections(); }

  defineChildren() {
    this.updateButtonSelections(); // Initial state before rendering children
    return [
      new Component({ type: "h2", css_textAlign: "center", css_marginTop: "0px", css_marginBottom: "20px", value: "Settings ⚙️" }),
      new Component({ type: "p", css_textAlign: "center", css_marginBottom: "5px", value: "Character Set" }),
      new Component({ css_display: "flex", css_gap: "4px", css_justifyContent: "center", css_marginBottom:"15px", children: this.charsetButtons }),
      new Component({ type: "p", css_textAlign: "center", css_marginBottom: "5px", value: "Theme" }),
      new Component({ css_display: "flex", css_gap: "4px", css_justifyContent: "center", css_marginBottom:"15px", children: this.themeButtons }),
      new Component({ type: "p", css_textAlign: "center", css_marginBottom: "5px", value: "Display" }),
      new ButtonComponent({ css_width: "calc(100% - 20px)", css_marginLeft:"10px", css_marginBottom:"5px", on_click: () => { if(canvas) canvas.toggleGrid(); }, value: "Toggle Grid" }),
      new ButtonComponent({ accessibleBy: "glowToggleButton", css_width: "calc(100% - 20px)", css_marginLeft:"10px", on_click: () => this.toggleGlowSetting(), value: themeManager.glowEffectEnabled ? "Glow: ON" : "Glow: OFF" }),
    ];
  }
}

class InputComponent extends Component {
  type = "input";
  constructor(props){
      super(props);
      this.css_height = this.css_height || "34px";
      this.css_border = this.css_border || "1px solid";
      this.css_borderRadius = this.css_borderRadius || "6px";
      this.css_fontFamily = this.css_fontFamily || "bodyFont";
      this.css_fontSize = this.css_fontSize || "14px";
      this.css_outline = "none";
      this.css_padding = this.css_padding || "0 10px";
      this.css_boxSizing = "border-box";
  }
  defineTheme() {
    const theme = themeManager.getTheme();
    this.css("backgroundColor", theme.buttonBgColor || Theme.Color.white); // Use button like bg
    this.css("borderColor", theme.buttonBorderColor || Theme.Color.grey);
    this.css("color", theme.buttonFgColor || Theme.Color.black);
  }
  renderCallback() {
    super.renderCallback();
    if (this.prop_placeholder && this.element) { // Check element exists
        this.element.placeholder = this.prop_placeholder;
    }
  }
}

class ButtonComponent extends Component {
  type = "button";
  selected = false; 

  constructor(props) {
    super(props);
    if (props && props.selectByDefault !== undefined) this.selected = props.selectByDefault;
    this.css_fontFamily = this.css_fontFamily || "monospace";
    this.css_fontSize = this.css_fontSize || "12px";
    this.css_padding = this.css_padding || "8px 12px";
    this.css_borderRadius = this.css_borderRadius || "6px";
    this.css_height = this.css_height || "auto";
    this.css_border = this.css_border || "1px solid";
    this.css_userSelect = "none";
    this.css_cursor = "pointer";
    this.css_transition = "background-color 0.1s ease, box-shadow 0.1s ease";
    this.css_margin = this.css_margin || "2px";
    this.css_verticalAlign = "middle"; // For better icon-text alignment within button
    this.css_display = this.css_display || "inline-flex"; // For better alignment of content
    this.css_alignItems = this.css_alignItems || "center";
    this.css_justifyContent = this.css_justifyContent || "center";
  }

  defineTheme() {
    const theme = themeManager.getTheme();
    if (this.selected) {
      this.css("backgroundColor", theme.buttonSelectedBgColor || Theme.Color.blue);
      this.css("color", theme.buttonFgColor || Theme.Color.white); 
    } else {
      this.css("backgroundColor", theme.buttonBgColor || Theme.Color.lightGrey);
      this.css("color", theme.buttonFgColor || Theme.Color.black);
    }
    this.css("borderColor", theme.buttonBorderColor || Theme.Color.grey);
  }
  unselect() { this.selected = false; if (this.element) this.defineTheme(); }
  select() { this.selected = true; if (this.element) this.defineTheme(); }
  renderCallback() { if (this.element) this.defineTheme(); }
  
  on_mouseDown(event) { 
    if (this.element) this.css("backgroundColor", themeManager.getTheme().buttonClickBgColor || Theme.Color.darkBlue);
  }
  on_mouseUp(event) { 
    if (this.element) this.defineTheme();
  }
  on_mouseOut(event) { 
    if (this.element && this.element.style.backgroundColor === (themeManager.getTheme().buttonClickBgColor)){
         this.defineTheme(); 
    }
  }
}

class MenuButtonComponent extends ButtonComponent {
    constructor(props){ super(props); this.css_marginTop = this.css_marginTop || "5px"; this.css_marginBottom = this.css_marginBottom || "5px"; }
}

class ModeMenuButtonComponent extends MenuButtonComponent {
  constructor(icon, name, showCondition, setModes, activeModes, callback = () => {}) {
    super({}); 
    this.icon = icon; this.name = name;
    // Using innerHTML for value to include spans for icon and text
    this.value = `<span style="font-size: 1em; margin-right: 5px; vertical-align: middle;">${icon}</span><span style="vertical-align: middle;">${name}</span>`;
    this.showCondition = modeMaster.makeFunc(showCondition || []);
    this.callback = callback;
    this.setModes = modeMaster.makeFunc(setModes || []);
    this.activeModesCondition = (activeModes && activeModes.length) ? modeMaster.makeFunc(activeModes) : () => false;
    
    // Assign click handler for magic prop registration if `on_click` property is named `element_on_click`
    // Or, handle it directly in an overridden render or attach manually.
    // For simplicity, if Component base class handles "on_click" from props, it's fine.
    // If it needs to be this specific instance method:
    this.on_click = (event) => { // This will be picked up by magic prop if named "on_click"
        this.setModes();
        this.callback(event);
    };
  }
  defineChildren() { return []; } // Content is via this.value (innerHTML)
  isActive() { return this.activeModesCondition(); }
  refresh() { this.isActive() ? this.select() : this.unselect(); this.showCondition() ? super.show() : super.hide(); }
}

class MenuButtonLeftComponent extends ModeMenuButtonComponent {
    constructor(icon, name, sc, sm, am, cb) { 
        super(icon,name,sc,sm,am,cb); 
        this.css_width="calc(100% - 4px)"; // Full width in left menu container
        this.css_textAlign="left";
        this.css_paddingLeft="10px";
        this.css_justifyContent = "flex-start"; // Align content (icon+text) to left
    }
}

class MenuComponent extends Component { 
    buttons = []; 
    defineChildren() { return this.buttons; } 
    renderTheme() { 
        super.renderTheme();
        (this.buttons || []).forEach(button => {
            if (button && button.element && typeof button.defineTheme === 'function') button.defineTheme();
        });
    }
}

class ModeMenuComponent extends MenuComponent {
  refresh() { (this.buttons || []).forEach(b => { if (b && typeof b.refresh === 'function') b.refresh(); }); }
  renderCallback() { 
    super.renderCallback(); 
    if(modeMaster) modeMaster.registerCallback(() => this.refresh()); 
    this.refresh(); 
  }
}

class MainMenuComponent extends ModeMenuComponent {
  accessibleBy = "mainMenuComponent";
  constructor(props) {
    super(props);
    this.css_position = "fixed"; this.css_top="0"; this.css_left="0"; this.css_width="100%";
    this.css_display="flex"; this.css_flexWrap="wrap"; this.css_justifyContent="center";
    this.css_padding="5px"; this.css_gap="3px"; this.css_zIndex="1000"; this.css_height="auto";
    this.buttons = [ 
        new ModeMenuButtonComponent("➤","Select",[],[modeMaster.reset, "select"],[modeMaster.hasOr, "selected", "select"],() => layerManager.switchModeCallback()),
        new ModeMenuButtonComponent("◻","Square",[],[modeMaster.reset, "draw", "square"],[modeMaster.isDrawyMode, "square"],() => layerManager.switchModeCallback()),
        new ModeMenuButtonComponent("◯","Circle",[],[modeMaster.reset, "draw", "circle"],[modeMaster.isDrawyMode, "circle"],() => layerManager.switchModeCallback()),
        new ModeMenuButtonComponent("T","Text",[],[modeMaster.reset, "draw", "text"],[modeMaster.isDrawyMode, "text"],() => layerManager.switchModeCallback()), // Changed icon for clarity
        new ModeMenuButtonComponent("/","Line",[],[modeMaster.reset, "draw", "line", "free-line"],[modeMaster.isDrawyMode, "free-line"],() => layerManager.switchModeCallback()),
        new ModeMenuButtonComponent("↳","Step",[],[modeMaster.reset, "draw", "line", "step-line"],[modeMaster.isDrawyMode, "step-line"],() => layerManager.switchModeCallback()), // Changed icon
        new ModeMenuButtonComponent(" zigzag ","Switch",[],[modeMaster.reset, "draw", "line", "switch-line"],[modeMaster.isDrawyMode, "switch-line"],() => layerManager.switchModeCallback()), // Changed icon (CSS might be needed for good zigzag)
        new ModeMenuButtonComponent("◇","Diamond",[],[modeMaster.reset, "draw", "diamond"],[modeMaster.isDrawyMode, "diamond"],() => layerManager.switchModeCallback()),
        new ModeMenuButtonComponent("▦","Table",[],[modeMaster.reset, "draw", "table"],[modeMaster.isDrawyMode, "table"],() => layerManager.switchModeCallback()), // Changed icon
        new ModeMenuButtonComponent("✍","Free",[],[modeMaster.reset, "draw", "free"],[modeMaster.isDrawyMode, "free"],() => FreeLayer.startFreeDraw()), // Changed icon
        new ModeMenuButtonComponent("⌫","Erase",[],[modeMaster.reset, "erase", "ebutton"],[modeMaster.hasOr, "erasing", "erase"],() => layerManager.switchModeCallback()),
        new ModeMenuButtonComponent("↺", "Undo", [], [], [], event => {if(layerManager)layerManager.undoEvent(event);}),
        new ModeMenuButtonComponent("↻", "Redo", [], [], [], event => {if(layerManager)layerManager.redoEvent(event);}),
        new ModeMenuButtonComponent("🗑️", "Restart", [], [], [], () => { if(confirm("Restart? Unsaved work will be lost.")) {if(layerManager)layerManager.refresh(() => layerManager.emptyEvent());} }),
        new ModeMenuButtonComponent("📋", "Copy Text", [], [], [], () => {if(canvas)canvas.exportToClipboard();}),
        new ModeMenuButtonComponent("🖼️", "PNG", [], [], [], () => {if(canvas)canvas.exportToPNG();}),
        new ModeMenuButtonComponent("✒️", "SVG", [], [], [], () => {if(canvas)canvas.exportToSVG();}),
        new ModeMenuButtonComponent("⇔", "Base64 I/O", [], [], [], () => {if(bodyComponent)bodyComponent.base64IOComponent.toggle();}),
        new ModeMenuButtonComponent("⚙️", "Settings", [], [], [], () => {if(bodyComponent)bodyComponent.settingsComponent.toggle();}),
        new ModeMenuButtonComponent("❓", "Help", [], [], [], () => {if(bodyComponent)bodyComponent.helpComponent.toggle();}),
    ];
  }
  defineTheme() { super.defineTheme(); const t = themeManager.getTheme(); this.css("backgroundColor", t.bodyBgColor || Theme.Color.lightGrey); this.css("boxShadow", `0 1px 3px ${t.nearBlack || 'rgba(0,0,0,0.1)'}`); }
}

class LeftMenuComponent extends ModeMenuComponent {
  accessibleBy = "leftMenuComponent";
  drawFreeOptions = [ ["_lines", "-|", "Lines"], ["█", "█", "Fill"], ["x", "x", "X"], ["*", "*", "*"], [".", ".", "."], ["+", "+", "+"], ["•", "•", "•"] ];
  constructor(props) {
    super(props); // Pass props to allow css_top override
    this.css_position="fixed"; this.css_left="5px"; 
    this.css_top = (props && props.css_top) || "65px"; // Use passed css_top or default
    this.css_width="145px"; this.css_height=`calc(100vh - ${parseInt(this.css_top.replace('px','')) + 10}px)`;
    this.css_overflowY="auto"; this.css_padding="5px 0"; this.css_zIndex="900";
    this.css_boxSizing = "border-box";

    this.buttons = [ 
        new MenuButtonLeftComponent("⧉", "Copy", [modeMaster.has, "selected"], [], [], e => layerManager.copySelectedLayersEvent(e)),
        new MenuButtonLeftComponent("⧓", "Group", [modeMaster.has, "multi-select", "selected"], [], [], e => layerManager.groupSelectedLayersEvent(e)),
        new MenuButtonLeftComponent("⧎", "Ungroup", [modeMaster.has, "multi-select", "selected"], [], [], e => layerManager.ungroupSelectedLayersEvent(e)),
        new MenuButtonLeftComponent("✕","Delete",[modeMaster.has, "selected"],[modeMaster.reset, "select"],[],e => layerManager.deleteLayersEvent(e)),
        new MenuButtonLeftComponent("↑", "Forward", [modeMaster.has, "selected"], [], [], e => layerManager.bringForwardEvent(e)),
        new MenuButtonLeftComponent("↓", "Backwards", [modeMaster.has, "selected"], [], [], e => layerManager.sendBackwardsEvent(e)),
        new MenuButtonLeftComponent("⇑", "Front", [modeMaster.has, "selected"], [], [], e => layerManager.bringToFrontEvent(e)),
        new MenuButtonLeftComponent("⇓", "Back", [modeMaster.has, "selected"], [], [], e => layerManager.sendToBackEvent(e)),
        new MenuButtonLeftComponent("⏴", "Arrow L", [modeMaster.has, "selected", "line"], [], [], () => layerManager.redrawLinesEvent("left")),
        new MenuButtonLeftComponent("⏵", "Arrow R", [modeMaster.has, "selected", "line"], [], [], () => layerManager.redrawLinesEvent("right")),
        new MenuButtonLeftComponent("┈", "Dotted", [modeMaster.has, "selected", "line-based"], [], [], () => layerManager.redrawLineBasedEvent("dotted")),
        new MenuButtonLeftComponent("┉", "Dashed", [modeMaster.has, "selected", "line-based"], [], [], () => layerManager.redrawLineBasedEvent("dashed")),
        new MenuButtonLeftComponent("─", "Solid", [modeMaster.has, "selected", "line-based"], [], [], () => layerManager.redrawLineBasedEvent("solid-thin")),
        new MenuButtonLeftComponent("━", "Solid Bold", [modeMaster.has, "selected", "line-based"], [], [], () => layerManager.redrawLineBasedEvent("solid-bold")),
    ].concat(this.drawFreeButtons());
  }
  drawFreeButtons() {
    let btns = [];
    for (let [char, icon, name] of this.drawFreeOptions) {
      btns.push(new MenuButtonLeftComponent(icon, name, 
        [modeMaster.has, "draw", "free"], 
        [], // No mode change on click, just sets char
        [() => FreeLayer.freeChar === char && modeMaster.has("draw", "free")], // Active condition
        () => { FreeLayer.setFreeChar(char); this.refresh(); } // Action and refresh menu for selection state
      ));
    } return btns;
  }
  defineTheme() { super.defineTheme(); const t = themeManager.getTheme(); this.css("backgroundColor", t.bodyBgColor || Theme.Color.lightGrey); this.css("borderRight", `1px solid ${t.buttonBorderColor || Theme.Color.grey}`); }
  refresh(){ super.refresh(); if(this.element && this.buttons) this.element.style.display = this.buttons.some(b=>b.visible) ? 'block' : 'none';}
}

class CanvasDumpComponent extends Component {
  accessibleBy = "canvasDumpComponent"; type = "div";
  constructor(props){ super(props); this.css_position="fixed";this.css_left="-99999px";this.css_top="-99999px";this.css_opacity="0"; this.css_pointerEvents="none"; this.css_whiteSpace="pre";}
  defineTheme(){ const t=themeManager.getTheme(); this.css("fontFamily", t.canvasFont || "monospace"); this.css("backgroundColor",t.canvasBgColor || "white");this.css("color",t.pixelNormalFgColor||"black"); }
}

class InformerComponent extends Component {
  accessibleBy = "informerComponent"; hideTimeout = null;
  constructor(props){
      super(props);
      this.css_position="fixed"; this.css_bottom="20px"; this.css_left="50%"; this.css_transform="translateX(-50%) translateY(120%)";
      this.css_width="auto"; this.css_maxWidth="calc(100% - 40px)"; this.css_minWidth="250px"; this.css_padding="12px 20px";
      this.css_borderRadius="8px"; this.css_boxShadow="0 2px 10px rgba(0,0,0,0.2)"; this.css_fontSize="14px";
      this.css_textAlign="center"; this.css_zIndex="2000"; this.css_transition="opacity .3s ease, transform .3s ease";
      this.css_pointerEvents="none"; // So it doesn't intercept clicks if transparent
  }
  defineChildren() { return [ new Component({ accessibleBy: "moodCharComponent", type: "span", css_fontSize: "1.2em", css_marginRight: "10px", css_verticalAlign:"middle" }), new Component({ accessibleBy: "messageComponent", type: "span", css_verticalAlign:"middle" }) ]; }
  report(message, mood="default", time=null){
    if (time === null) time = Math.max(2500, message.length * 120);
    if (this.hideTimeout) clearTimeout(this.hideTimeout);
    let moodChar = "ℹ️"; let bgColorKey = "informerDefaultBgColor"; let fgColorKey = "informerDefaultFgColor";
    const theme = themeManager.getTheme();
    switch(mood){case "good": moodChar="✓"; bgColorKey=theme.informerGoodBgColor; fgKey=theme.informerGoodFgColor; break; case "bad": moodChar="✕"; bgColorKey=theme.informerBadBgColor; fgKey=theme.informerBadFgColor; break; case "loading": moodChar="⏳"; time = -1; break;}
    
    this.css("backgroundColor", bgColorKey || Theme.Color.blue); // Fallback for bgColorKey
    if(this.moodCharComponent) {this.moodCharComponent.setValue(moodChar); this.moodCharComponent.css("color", fgKey || Theme.Color.black);}
    if(this.messageComponent) {this.messageComponent.setValue(message); this.messageComponent.css("color", fgKey || Theme.Color.black);}
    
    if(this.element) {this.element.style.opacity="1"; this.element.style.transform="translateX(-50%) translateY(0)";}
    super.show();
    if(time !== -1) this.hideTimeout = setTimeout(() => this.hide(), time);
  }
  hide() { if(!this.element) return; this.element.style.opacity="0"; this.element.style.transform="translateX(-50%) translateY(120%)"; setTimeout(()=>super.hide(),300); }
  loading(){this.report("Loading...","loading");} loadingFinish(){if(this.hideTimeout) clearTimeout(this.hideTimeout); this.hide();}
  renderCallback(){ if(this.element) {this.element.style.opacity="0"; this.element.style.display="none";} } // Initially hidden
}


// --- Body Component (App Root) ---
class Body extends Component {
  type = "body";

  create() {
    this.element = document.body;
    this.element.style.margin = "0";
    this.element.style.padding = "0";
    this.element.style.height = "100vh";
    this.element.style.overflow = "hidden";
    this.element.style.position = "relative"; 
  }
  assignParent() {}

  defineChildren() {
    const mainMenu = new MainMenuComponent();
    // Estimate main menu height for positioning other elements.
    // A more robust way would be to get its actual height after it renders, but for fixed layout this is often okay.
    const approxMainMenuHeight = 60; // px - Adjust if MainMenuComponent changes height significantly

    const leftMenu = new LeftMenuComponent({ css_top: `${approxMainMenuHeight}px`});
    const leftMenuWidth = 150; // px - (LeftMenu width + padding/margin)

    const canvasComp = new CanvasComponent({
        css_position: "absolute", 
        css_top: `${approxMainMenuHeight}px`,
        css_left: `${leftMenuWidth}px`,
        css_width: `calc(100% - ${leftMenuWidth}px - 5px)`, // -5px for some right padding
        css_height: `calc(100vh - ${approxMainMenuHeight}px - 5px)`, // -5px for some bottom padding
        css_overflow: "auto" // Changed to auto to allow canvas scrolling if content exceeds bounds
    });

    return [
      mainMenu, leftMenu, canvasComp,
      new InformerComponent(), new SettingsComponent(), new HelpComponent(),
      new Base64IOComponent(), new CanvasDumpComponent(),
    ];
  }

  hidePopups() {
    if(modeMaster) modeMaster.setDefault();
    (this.children || []).forEach(child => {
      if (child && child.isPopup && child.visible) child.hide();
    });
  }

  defineTheme() {
    const theme = themeManager.getTheme();
    this.css("backgroundColor", theme.bodyBgColor || Theme.Color.white);
    this.css("color", theme.bodyFgColor || Theme.Color.black);
    this.css("fontFamily", theme.bodyFont || "monospace");
  }
}

// --- Main Initialization Logic ---
function handleFirstVisit() {
  if (firstVisit && bodyComponent && bodyComponent.helpComponent) {
    bodyComponent.helpComponent.show();
    let shownTip = false;
    const tipCallback = () => {
      if (modeMaster && modeMaster.has("draw") && !shownTip && bodyComponent.informerComponent) {
        bodyComponent.informerComponent.report("Click and drag to start drawing!", "default");
        shownTip = true;
        if (modeMaster.callbacks) modeMaster.callbacks = modeMaster.callbacks.filter(cb => cb !== tipCallback);
      }
    };
    if (modeMaster) modeMaster.registerCallback(tipCallback);
  }
  localStorage.setItem("visited", "true");
}

function initManagers() {
  themeManager = new ThemeManager();
  // LayerManager might depend on ThemeManager if layers use theme colors in constructor,
  // but typically colors are applied during render.
  layerManager = new LayerManager();
  modeMaster = new ModeMaster(); // Used by EventManager and components
  areaSelectManager = new AreaSelectManager();
  charManager = new CharManager();
  // EventManager constructor now defines its MAP, which uses modeMaster.
  // Ensure modeMaster is ready.
  eventManager = new EventManager(); 
  externalHookManager = new BaseExternalHookManager();
}

function main() {
  if (isTablet()) {
    mobilePage(); // This replaces document.body.innerHTML
    return;
  }

  initManagers();

  bodyComponent = new Body(); 
  bodyComponent.render();    

  if (bodyComponent && bodyComponent.canvasComponent) {
    canvas = bodyComponent.canvasComponent; // Global reference to the canvas UI component
  } else {
    console.error("CRITICAL: Canvas component (canvasComponent) not found on bodyComponent after render.");
    document.body.innerHTML = "Error: Failed to initialize canvas. Please check console.";
    return; 
  }

  if (canvas && canvas.element && document) {
    eventManager.assignAll({
      window: window,
      document: document,
      canvas: canvas.element, 
    });
  } else {
      console.error("CRITICAL: Cannot assign events. Canvas DOM element or document not ready.");
  }

  if (layerManager) layerManager.importFromLocalStorage();
  handleFirstVisit();

  window.dispatchEvent(new Event("casciiLoaded"));
  console.log("CASCII Enhanced Initialized - Separated Files Version:", VERSION);
}

// Wait for the DOM to be fully loaded before running main
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
} else {
    main(); // DOMContentLoaded has already fired
}
