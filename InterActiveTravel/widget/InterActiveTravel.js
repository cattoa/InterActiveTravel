/*global mx, mendix, require, console, define, module, logger */
/**

	InterActiveGrid
	========================

	@file      : InterActiveGrid.js
	

	Documentation
    ========================
	Inter Active Grid

*/

(function () {
    'use strict';

    require([

        'dojo/_base/declare', 'mxui/widget/_WidgetBase', 'dijit/_Widget',
        'mxui/dom', 'dojo/dom-class', 'dojo/dom-construct', 'dojo/_base/lang', 'dojo/number',  'dojo/date/locale','dojo/query'

    ], function (declare, _WidgetBase, _Widget, domMx, domClass, domConstruct, lang, dojoNumber, dojoDateLocale, dojoQuery) {

        // Declare widget.
        return declare('InterActiveGrid.widget.InterActiveGrid', [ _WidgetBase, _Widget ], {

            widgetContext                   : null,
            contextGUID                     : null,
            getDataMicroflowCallPending     : null,
            handle                          : null,
            mendixObjectArray               : null,
            cellMap                         : {},
            dataMap                         : {},
            xKeyArray                       : [],
            yKeyArray                       : [],
            entityMetaData                  : null,
            progressDialogId                : null,
            cellValueAttrType               : null,
            onClickXIdValue                 : null,
            onClickYIdValue                 : null,
            onClickMendixObject             : null,
            onCellClickReferenceName        : null,
            exportMendixObject              : null,

            /**
             * Called by the Mendix runtime after creation.
             */
            postCreate: function () {
                
                domClass.add(this.domNode, "InterActiveGrid");
                // Load CSS ... automatically from ui directory

                if (this.onCellClickReference) {
                    this.onCellClickReferenceName = this.onCellClickReference.substr(0, this.onCellClickReference.indexOf('/'));
                }
            },

            /**
             * Called by the Mendix runtime to make the context available
             *
             * @param context       The context to use
             * @param callback      The callback to call when done accepting the context, may be null
             */
            applyContext: function (context, callback) {
                var
                    thisObj = this;

                console.debug(this.domNode.id + ": applyContext");

                if (this.handle) {
                    mx.data.unsubscribe(this.handle);
                }

                if (context) {
                    this.widgetContext = context;
                    this.contextGUID = context.getTrackID();
                    if (this.checkProperties()) {
                        this.entityMetaData = mx.meta.getEntity(this.entity);
                        console.debug(this.domNode.id + ": applyContext, context object GUID: " + this.contextGUID);
                        if (this.callGetDataMicroflow === "crtOnly" || this.callGetDataMicroflow === "crtAndChg") {
                                thisObj.getData();
                        }
                        if (this.callGetDataMicroflow === "crtAndChg" || this.callGetDataMicroflow === "chgOnly") {
                            this.handle = mx.data.subscribe({
                                guid: this.contextGUID,
                                callback: lang.hitch(this, this.contextObjectChangedCallback)
                            });
                        }
                    }
                } else {
                    alert(this.id + ".applyContext received empty context");
                }
                if (callback) {
                    callback();
                }
            },

            checkProperties: function () {

                // console.log(this.domNode.id + ": checkProperties");

                var
                    errorMessageArray = [];
                    
                if (this.positionTopSubmitButton || positionBottomSubmitButton) {
                    if (this.submitButtonCaption === "") {
                        errorMessageArray.push("When submit button is specified, a caption must be specified for the button");
                    }
                    if (this.submitButtonMicroflow === null) {
                        errorMessageArray.push("When submit button is specified a microflow to be executed must be specified too");
                    }
                }
                
                if (this.allowYGroup){
                    
                    if (this.yGroupAttr === null) {
                        errorMessageArray.push("When allow y grouping is specified an attribute but be selected that will be used to group on");
                    }
                }

                if (this.allowSelect){
                    
                    if (this.cellSelectAttr === null) {
                        errorMessageArray.push("When allow select is specified an attribute but be selected that will be set by the selection process");
                    }
                }

                if (errorMessageArray.length > 0) {
                    this.showConfigurationErrors(errorMessageArray);
                }

                return (errorMessageArray.length === 0);
            },


            contextObjectChangedCallback: function () {

                console.debug(this.domNode.id + ": Context object has changed");
                this.getData();
            },

            /**
             * Call the microflow to get the data
             */
            getData: function () {

                console.debug(this.domNode.id + ": Call microflow to get the data");

                if (this.getDataMicroflowCallPending) {
                    // Prevent problems when Mendix runtime calls applyContext multiple times
                    // When the microflow commits the context object, we might go into an endless loop!
                    console.log(this.domNode.id + ": Skipped microflow call as we did not get an answer from a previous call.");
                    return;
                }
                this.getDataMicroflowCallPending = true;
                this.showProgress();

                var args = {
                    params: {
                        actionname: this.getDataMicroflow
                    },
                    context: this.widgetContext,
                    callback: lang.hitch(this, this.dataMicroflowCallback),
                    error: lang.hitch(this, this.dataMicroflowError)
                };
                mx.data.action(args);
            },

            /**
             * Called upon completion of the microflow
             *
             * @param mendixObjectArray      The list as returned from the microflow
             */
            dataMicroflowCallback: function (mendixObjectArray) {

                var
                    noDataNode;

                console.debug(this.domNode.id + ": dataMicroflowCallback");

                this.getDataMicroflowCallPending = false;
                this.hideProgress();

                this.mendixObjectArray = mendixObjectArray;

                // Remove any old data
                domConstruct.empty(this.domNode);
                this.cellMap        = {};
                this.xKeyArray      = [];
                this.yKeyArray      = [];    


                if (this.checkData()) {
                    if (this.mendixObjectArray.length > 0) {
                        this.buildTableData();
                        this.createTable();
                    } else {
                        noDataNode = domMx.p(this.noDataText);
                        domClass.add(noDataNode, this.noDataTextClass);
                        this.domNode.appendChild(noDataNode);
                    }
                }

            },

            /**
             * Called when the microflow call ended with an error
             *
             * @param err       The error object, if any
             */
            dataMicroflowError: function (err) {

                this.hideProgress();
                this.getDataMicroflowCallPending = false;

                console.dir(err);
                alert("Call to microflow " + this.getDataMicroflow + " ended with an error");
            },

            /**
             * Check whether the returned data is correct.
             *
             * @returns {boolean}       True if correct, false otherwise
             */
            checkData: function () {

                console.debug(this.domNode.id + ": checkData " + Object.prototype.toString.call(this.mendixObjectArray));
                
                // If empty array is return from Mendix then do nothing 
                if (Object.prototype.toString.call(this.mendixObjectArray) === "[object String]"){
                    console.debug(this.domNode.id + ": checkData empty array do nothing");
                    return false;
                }
                var
                    errorMessageArray = [];

                if (this.mendixObjectArray !== null) {
                    if (Object.prototype.toString.call(this.mendixObjectArray) === "[object Array]") {
                        if (this.mendixObjectArray.length > 0 && this.mendixObjectArray[0].getEntity() !== this.entity) {
                            errorMessageArray.push("Microflow " + this.getDataMicroflow + " returns a list of " + this.mendixObjectArray[0].getEntity() +
                                " while the entity property is set to " + this.entity);
                        }
                    } else {
                        errorMessageArray.push("Microflow " + this.getDataMicroflow + " does not return a list of objects");
                    }
                } else {
                    errorMessageArray.push("Microflow " + this.getDataMicroflow + " does not return a list of objects");
                }

                if (errorMessageArray.length > 0) {
                    this.showConfigurationErrors(errorMessageArray);
                }

                return (errorMessageArray.length === 0);
            },

            showConfigurationErrors: function (errorMessageArray) {

                var
                    i,
                    listNode;

                this.domNode.appendChild(domMx.p("Configuration error(s) found"));
                domClass.add(this.domNode, "InterActiveGridConfigurationError");
                listNode = document.createElement("ul");
                for (i = 0; i < errorMessageArray.length; i = i + 1) {
                    listNode.appendChild(domMx.li(errorMessageArray[i]));
                }
                this.domNode.appendChild(listNode);
            },

            /**
             * Display action
             *
             * @param valueArray    The value array from the cell map
             * @returns cell value
             */
            getCellDisplayValue: function (valueArray) {
                return valueArray.join();
            },

            /**
             * Build table data
             */
            buildTableData: function () {

                console.debug(this.domNode.id + ": buildTableData");

                var
                    mendixObject,
                    mendixObjectIndex,
                    cellMapKey,
                    cellMapObject,
                    cellValue,
                    cellId,
                    sortAttr,
                    xIdValue,
                    xLabelValue,
                    xSortValue,
                    xSortValueMap = {},
                    yIdValue,
                    yLabelValue,
                    ySortValue,
                    ySortValueMap = {},
                    yGroupValue;

                console.debug(this.domNode.id + ": Process Mendix object array");
                this.dataMap = {};
                for (mendixObjectIndex = 0; mendixObjectIndex < this.mendixObjectArray.length; mendixObjectIndex = mendixObjectIndex + 1) {
                    mendixObject    = this.mendixObjectArray[mendixObjectIndex];
                    // For display, convert to display value as no aggregation will take place.
                    cellValue   = mendixObject.get(this.cellValueAttr);
                    //console.debug(this.domNode.id + ": Process Mendix value : " + cellValue);
                    cellId = mendixObject.getGUID();
                    this.dataMap[cellId] = mendixObject;
                    //console.debug(this.domNode.id + ": Process Mendix id : " + cellId);
                    
                    xIdValue        = this.getSortKey(mendixObject, this.xIdAttr);
                    yIdValue        = this.getSortKey(mendixObject, this.yIdAttr);
                    xLabelValue     = this.getDisplayValue(mendixObject, this.xLabelAttr, this.xLabelDateformat);
                    yLabelValue     = this.getDisplayValue(mendixObject, this.yLabelAttr, this.yLabelDateformat);
                    yGroupValue     = this.getDisplayValue(mendixObject, this.yGroupAttr,"");
                    if (this.xSortAttr === "label") {
                        xSortValue  = xLabelValue;
                    } else {
                        xSortValue  = xIdValue;
                    }
                    if (this.ySortAttr === "label") {
                        ySortValue  = yLabelValue;
                    } else {
                        ySortValue  = yIdValue;
                    }
                    cellMapKey      = xIdValue + "_" + yIdValue;
                    if (this.cellMap[cellMapKey]) {
                        cellMapObject = this.cellMap[cellMapKey];
                        cellMapObject.cellId = cellId;
                        cellMapObject.cellValueArray.push(cellValue);
                        cellMapObject.yGroupValue = yGroupValue;
                        cellMapObject.displayCssValue = mendixObject.get(this.cellValueCss) + " " + this.gridClass;
                    } else {
                        cellMapObject = {
                            cellId          : cellId,
                            xIdValue        : xIdValue,
                            yIdValue        : yIdValue,
                            cellValueArray  : [cellValue],
                            yGroupValue      : yGroupValue,
                            displayCssValue : mendixObject.get(this.cellValueCss) + " " + this.gridClass
                        };
                        // Save sort key value in the map object too, used as additional styling CSS class
                        // Only for the first object; CSS class is not applied when multiple objects exist for one cell.
                        this.cellMap[cellMapKey] = cellMapObject;
                    }
                    // console.debug(this.domNode.id + ": Process Mendix object xIdValue: " + xIdValue);
                    // console.debug(this.domNode.id + ": Process Mendix object xLabelValue: " + xLabelValue);
                    
                    if (!xSortValueMap[xSortValue]) {
                        xSortValueMap[xSortValue] = { idValue : xIdValue, labelValue : xLabelValue};
                    }
                    
                    // console.debug(this.domNode.id + ": Process Mendix object yIdValue: " + yIdValue);
                    // console.debug(this.domNode.id + ": Process Mendix object yLabelValue: " + yLabelValue);
                    if (!ySortValueMap[ySortValue]) {
                        ySortValueMap[ySortValue] = { idValue : yIdValue, labelValue : yLabelValue};
                    }
                }

                console.debug(this.domNode.id + ": Perform requested action on the data");

                for (cellMapKey in this.cellMap) {
                    if (this.cellMap.hasOwnProperty(cellMapKey)) {
                        cellMapObject = this.cellMap[cellMapKey];
                        cellMapObject.cellValue = this.getCellDisplayValue(cellMapObject.cellValueArray);
                    }
                }

                console.debug(this.domNode.id + ": Sort the X and Y axis data");

                if (this.xSortAttr === "label") {
                    sortAttr = this.xLabelAttr;
                } else {
                    sortAttr = this.xIdAttr;
                }
                console.debug(this.domNode.id + ": Sort the XKey Attr: " + sortAttr);
                this.xKeyArray = this.sortAxisData(xSortValueMap, sortAttr, this.xSortDirection);
                
                
                if (this.ySortAttr === "label") {
                    sortAttr = this.yLabelAttr;
                } else {
                    sortAttr = this.yIdAttr;
                }
                console.debug(this.domNode.id + ": Sort the YKey Attr: " + sortAttr);
                this.yKeyArray = this.sortAxisData(ySortValueMap, sortAttr, this.ySortDirection);

            },

            /**
             * Sort the axis data
             *
             * @param sortValueMap      The data to sort
             * @param sortAttr          The name of the sort attribute
             * @param sortDirection     The sort direction
             * @returns                 Sorted array
             */
            sortAxisData : function (sortValueMap, sortAttr, sortDirection) {

                var
                    arrayIndex,
                    attrType,
                    axisDataArray = [],
                    keyArray,
                    sortKey,
                    sortObject;
                  
                
                attrType = this.entityMetaData.getAttributeType(sortAttr); 
                console.debug(this.domNode.id + ": sortAxisData attr type : " + attrType);
                switch (attrType) {
                case "AutoNumber":
                case "Integer":
                case "Long":
                case "Currency":
                case "Float":
                case "DateTime":
                    keyArray = Object.keys(sortValueMap).sort(function (a, b) {return a - b; });
                    break;
                default:
                    keyArray = Object.keys(sortValueMap).sort();
                }

                if (sortDirection === "desc") {
                    keyArray.reverse();
                }
                
                console.debug(this.domNode.id + ": sortAxisData keyArray size : " + keyArray.length);
                for (arrayIndex = 0; arrayIndex < keyArray.length; arrayIndex = arrayIndex + 1) {
                    sortKey = keyArray[arrayIndex];
                    sortObject = sortValueMap[sortKey];
                    axisDataArray.push(sortObject);
                    
                console.debug("Sort Key" + sortKey);
                }

                return axisDataArray;
            },

            /**
             * Create the table
             */
            createTable: function () {

                console.debug(this.domNode.id + ": createTable");

                var
                    cellMapKey,
                    cellMapObject,
                    cellValue,
                    cellId,
                    colIndex,
                    displayValueCellClass,
                    submitButton,
                    footerRowNode,
                    headerRowNode,
                    node,
                    nodeValue,
                    rowNode,
                    rowIndex,
                    tableNode,
                    topLeftCellNode,
                    bottomLeftCellNode,
                    tresholdClass,
                    xIdValue,
                    yIdValue,
                    xColCount,
                    yLabelValue,
                    yGroupValue,
                    newYGroupValue;

                // Create table
                tableNode = document.createElement("table");

                // Header row
                headerRowNode = document.createElement("tr");
                topLeftCellNode = document.createElement("th");
                
                 
                if (this.positionTopSubmitButton){
                    submitButton = document.createElement('button');
                    submitButton.setAttribute('type', 'button');
                    domClass.add(submitButton, 'btn mx-button btn-default ' + this.submitButtonClass);
                    if (this.submitButtonCaption) {
                        submitButton.innerHTML = this.submitButtonCaption;
                    }
                    submitButton.onclick = lang.hitch(this, this.submitSelectionEvent);
                    topLeftCellNode.appendChild(submitButton);
                }
               
                headerRowNode.appendChild(topLeftCellNode);
                for (colIndex = 0; colIndex < this.xKeyArray.length; colIndex = colIndex + 1) {
                    headerRowNode.appendChild(this.createHeaderNode(this.xKeyArray[colIndex].labelValue));
                }
                tableNode.appendChild(headerRowNode);

                // Rows
                //get First CellMap
                
                for (rowIndex = 0; rowIndex < this.yKeyArray.length; rowIndex = rowIndex + 1) {
                    if (this.allowYGroup){
                        xColCount = this.xKeyArray.length + 1;
                        yIdValue = this.yKeyArray[rowIndex].idValue;
                        xIdValue = this.xKeyArray[0].idValue;
                        cellMapKey = xIdValue + "_" + yIdValue;
                        cellMapObject = this.cellMap[cellMapKey];
                        newYGroupValue = cellMapObject.yGroupValue;
                        if (yGroupValue !== newYGroupValue){
                            headerRowNode = document.createElement("tr");
                            topLeftCellNode = document.createElement("th");
                            headerRowNode.appendChild(this.insertBreak(newYGroupValue,xColCount));
                            tableNode.appendChild(headerRowNode);
                            yGroupValue = newYGroupValue;
                        }
                    }
                    rowNode = document.createElement("tr");
                    // Get the label and the ID
                    yLabelValue = this.yKeyArray[rowIndex].labelValue;
                    yIdValue = this.yKeyArray[rowIndex].idValue;
                    
                    // The row label
                    node = domMx.th(yLabelValue);
                    domClass.add(node, this.yLabelClass);
                    
                    rowNode.appendChild(node);

                    // Columns
                    
                    for (colIndex = 0; colIndex < this.xKeyArray.length; colIndex = colIndex + 1) {
                        // Get the ID
                        xIdValue            = this.xKeyArray[colIndex].idValue;
                        cellMapKey          = xIdValue + "_" + yIdValue;
                        // It is possible that no values exists for a given combination of the two IDs
                        tresholdClass = null;
                        displayValueCellClass = null;
                        
                        if (this.cellMap[cellMapKey]) {
                            cellMapObject   = this.cellMap[cellMapKey];
                            cellId          = cellMapObject.cellId;
                            cellValue       = cellMapObject.cellValue;
                            newYGroupValue  = cellMapObject.yGroupValue;
                            // Process the styling tresholds, if requested
                            // Action display, use value as CSS class?
                            if (cellMapObject.displayCssValue) {
                                displayValueCellClass =cellMapObject.displayCssValue; //.replace(/[^A-Za-z0-9]/g, '_');
                            }
                            nodeValue      = cellValue;
                        } else {
                            nodeValue       = "?";
                        }
                        node                = document.createElement("td");
                        node.innerHTML      = nodeValue;
                        //node.setAttribute(this.xIdAttr, xIdValue);
                        //node.setAttribute(this.yIdAttr, yIdValue);
                        node.setAttribute("cellId",cellId);
                        if (this.allowSelect){
                            node.onclick = lang.hitch(this, this.onClickCell);
                        }
                        // Additional class based on the treshold?
                        // Additional class for display?
                        if (displayValueCellClass) {
                            domClass.add(node, displayValueCellClass);
                        }
                        rowNode.appendChild(node);
                    }
                    

                    tableNode.appendChild(rowNode);
                }
                
                //Bottom Submit button
                
                
                if (this.positionBottomSubmitButton){
                    footerRowNode = document.createElement("tr");
                    bottomLeftCellNode = document.createElement("th");    submitButton = document.createElement('button');
                    submitButton.setAttribute('type', 'button');
                    domClass.add(submitButton, 'btn mx-button btn-default ' + this.submitButtonClass);
                    if (this.submitButtonCaption) {
                        submitButton.innerHTML = this.submitButtonCaption;
                    }
                    submitButton.onclick = lang.hitch(this, this.submitSelectionEvent);
                    bottomLeftCellNode.appendChild(submitButton);
                    footerRowNode.appendChild(bottomLeftCellNode);
                    tableNode.appendChild(footerRowNode);
                }
                
                // Show the table
                this.domNode.appendChild(tableNode);

            },

            /**
             * Create a header cell node.
             *
             * @param headerValue   The value to show in the header
             * @@returns The node
             */
            createHeaderNode : function (headerValue) {

                var
                    divNode,
                    headerNode,
                    spanNode;

                // Create the span containing the header value
                spanNode = domMx.span(headerValue);

                // Create the div
                divNode = document.createElement("div");
                divNode.appendChild(spanNode);

                // Create the th
                headerNode = document.createElement("th");
                headerNode.appendChild(divNode);
                domClass.add(headerNode, this.xLabelClass);

                return headerNode;

            },
            
            /** 
             * Called when building table and the GroupValue changes
             * 
             * @param String newYGroupValue the value to be displayed for the group header
             * 
             * 
             * returns the node
             */        
            insertBreak : function(newYGroupValue,xColCount){
                var
                    divNode,
                    groupNode,
                    spanNode;
            
                // Create the span containing the group name value
                spanNode = domMx.span(newYGroupValue);

                // Create the div
                divNode = document.createElement("div");
                divNode.appendChild(spanNode);

                // Create the th
                groupNode = document.createElement("th");
                groupNode.appendChild(divNode);
                domClass.add(groupNode, this.yGroupClass);
                groupNode.setAttribute("colspan",xColCount);

                return groupNode;
                
            },

            /**
             * Called when the user clicks on a cell
             *
             * @param evt  The click event
             */
            onClickCell : function (evt) {
                debugger;
                var
                    objGuid,
                    objClass,
                    mendixObject;
                
                objGuid = evt.target.getAttribute("cellid");     
                if (objGuid){     
                    mendixObject = this.dataMap[objGuid];
                    if (mendixObject){
                        objClass = evt.target.getAttribute("class"); 
                        if (objClass.indexOf(this.selectionClass) !== -1){
                            evt.target.setAttribute("class", objClass.replace(' ' + this.selectionClass,''));
                            mendixObject.set(this.cellSelectAttr,false);
                        }
                        else {
                            evt.target.setAttribute("class", objClass + ' ' + this.selectionClass);
                            mendixObject.set(this.cellSelectAttr,true);
                            this.deselectData(mendixObject);
                        }
                        mx.data.save({
                            mxobj       : mendixObject,
                            callback    : lang.hitch(this, this.afterSaveDeselect )
                        });
                    }
                }
                console.debug("onClickCell");
            },
            
            
        afterSave : function (){
            console.debug("afterSave");
        },

            /**
             * Called when the user requests an export of the data
             *
             * @param evt  The click event
             */
            deselectData : function (mendixObjectIn) {
                var
                    xIdValue,
                    mendixObjectIndex,
                    mendixObject,
                    guid,
                    nodes,
                    objClass;
                    
                
                xIdValue = mendixObjectIn.get(this.xIdAttr);
                for (mendixObjectIndex = 0; mendixObjectIndex < this.mendixObjectArray.length; mendixObjectIndex = mendixObjectIndex + 1) {
                    mendixObject    = this.mendixObjectArray[mendixObjectIndex];
                    if (mendixObject.get(this.xIdAttr) === xIdValue){
                        if (mendixObject !== mendixObjectIn){
                            if (mendixObject.get(this.cellSelectAttr)){
                                mendixObject.set(this.cellSelectAttr,false);
                                guid = mendixObject.getGUID();
                                nodes = dojoQuery("." + this.selectionClass);
                                for(var x = 0; x < nodes.length; x++){
                                    if(nodes[x].getAttribute("cellId") === guid){
                                      objClass = nodes[x].getAttribute("class");
                                      objClass = objClass.replace(' ' + this.selectionClass,'')
                                      nodes[x].setAttribute("class",objClass );
                                    }
                                }
                           }
                        }
                        
                    }
                }
                
            },

             
            /**
             * Get the attribute value for use as sort key
             *
             * @param mendixObject  The Mendix object to take the value from
             * @param attrName      The attribute name
             * @returns {string}    The sort key
             */
            getSortKey : function (mendixObject, attrName) {

                var
                    attrType,
                    attrValue,
                    result;
                
                attrType = this.entityMetaData.getAttributeType(attrName); 
                attrValue = mendixObject.get(attrName);

                switch (attrType) {
                case "AutoNumber":
                case "Integer":
                case "Long":
                case "Currency":
                case "Float":
                case "DateTime":
                    result = Number(attrValue);
                    break;

                default:
                    result = attrValue;
                }

                return result;
            },

            /**
             * Get the attribute value for use as display value
             *
             * @param mendixObject  The Mendix object to take the value from
             * @param attrName      The attribute name
             * @param dateFormat    The date format to use for DateTime attributes
             * @returns {string}    The sort key
             */
            getDisplayValue : function (mendixObject, attrName, dateFormat) {

                var
                    attrType,
                    attrValue,
                    result;

                attrType = this.entityMetaData.getAttributeType(attrName); 
                attrValue = mendixObject.get(attrName);

                switch (attrType) {
                case "Currency":
                    result = this.formatCurrency(attrValue);
                    break;
                case "DateTime":
                    result = this.formatDateFromNumber(attrValue, dateFormat);
                    break;

                case "Enum":
                    result = this.entityMetaData.getEnumCaption(attrName, attrValue);
                    break;

                default:
                    result = attrValue;
                }

                return result;
            },

            /**
             * Show progress indicator, depends on Mendix version
             */
            showProgress: function () {
                this.progressDialogId = mx.ui.showProgress();
            },

            /**
             * Hide progress indicator, depends on Mendix version
             */
            hideProgress: function () {
                mx.ui.hideProgress(this.progressDialogId);
                this.progressDialogId = null;
            },

            /**
             * Parse a string into a date
             *
             * @param dateString    The date value
             * @param dateFormat    The date format string
             * @returns {Date}      The date
             */
            parseDate: function (dateString, dateFormat) {

                var
                    result;

                if (mx.parser.parseValue) {
                    result = mx.parser.parseValue(dateString, "datetime", { datePattern: dateFormat});
                } else {
                    result = dojoDateLocale.parse(dateString, { selector : "date", datePattern: dateFormat});
                }

                return result;
            },
            
            submitSelectionEvent : function(evt){
                console.debug("submitSelection");
                this.submitSelection();
            },
            
            submitSelection : function () {

               console.debug("submitSelection");
               
                mx.data.action({
                    params       : {
                        applyto     : "selection",
                        actionname  : this.submitButtonMicroflow,
                        guids : [this.contextGUID]
                    },
                    error        : lang.hitch(this, this.submitSelectionMicroflowError),
                    onValidation : lang.hitch(this, this.submitSelectionMicroflowError)
                });

            },
            
            submitSelectionMicroflowError : function (err) {

                console.dir(err);
                alert("Call to microflow " + this.exportDataMicroflow + " ended with an error");

            },    /**



            /**
             * Format a currency value
             *
             * @param value         The value to format
             * @returns {String}    The formatted value
             */
            formatCurrency: function (value) {

                var
                    result;

                if (mx.parser.formatValue) {
                    result = mx.parser.formatValue(value, "currency");
                } else {
                    result = dojoNumber.format(value, { places: 2 });
                }

                return result;
            },

            /**
             * Format a date using a number
             *
             * @param value         The date in milliseconds since the epoch.
             * @param dateFormat    The date format to use
             * @returns {String}    The formatted value
             */
            formatDateFromNumber: function (value, dateFormat) {

                var
                    result;

                if (mx.parser.formatValue) {
                    result = mx.parser.formatValue(new Date(value), "datetime", { datePattern: dateFormat});
                } else {
                    result = dojoDateLocale.format(new Date(value), { selector : "date", datePattern: dateFormat});
                }

                return result;
            },

            /**
             * Cleanup upon destruction of the widget instance.
             *
             */
            uninitialize: function () {
                console.debug(this.domNode.id + ": uninitialize");
                if (this.handle) {
                    mx.data.unsubscribe(this.handle);
                }
                if (this.progressDialogId) {
                    this.hideProgress();
                }
            }
        });
    });

}());
