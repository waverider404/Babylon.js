import * as React from "react";
import { GlobalState } from '../globalState';
import { NodeMaterialBlock } from 'babylonjs/Materials/Node/nodeMaterialBlock';
import { GraphNode } from './graphNode';
import * as dagre from 'dagre';
import { Nullable } from 'babylonjs/types';
import { NodeLink } from './nodeLink';
import { NodePort } from './nodePort';
import { NodeMaterialConnectionPoint, NodeMaterialConnectionPointDirection, NodeMaterialConnectionPointCompatibilityStates } from 'babylonjs/Materials/Node/nodeMaterialBlockConnectionPoint';
import { Vector2 } from 'babylonjs/Maths/math.vector';
import { FragmentOutputBlock } from 'babylonjs/Materials/Node/Blocks/Fragment/fragmentOutputBlock';
import { InputBlock } from 'babylonjs/Materials/Node/Blocks/Input/inputBlock';
import { DataStorage } from '../dataStorage';
import { GraphFrame } from './graphFrame';
import { IEditorData } from '../nodeLocationInfo';

require("./graphCanvas.scss");

export interface IGraphCanvasComponentProps {
    globalState: GlobalState
}

export class GraphCanvasComponent extends React.Component<IGraphCanvasComponentProps> {
    private readonly MinZoom = 0.1;
    private readonly MaxZoom = 4;

    private _hostCanvas: HTMLDivElement;
    private _graphCanvas: HTMLDivElement;
    private _selectionContainer: HTMLDivElement;
    private _groupContainer: HTMLDivElement;
    private _svgCanvas: HTMLElement;
    private _rootContainer: HTMLDivElement;
    private _nodes: GraphNode[] = [];
    private _links: NodeLink[] = [];
    private _mouseStartPointX: Nullable<number> = null;
    private _mouseStartPointY: Nullable<number> = null
    private _dropPointX = 0;
    private _dropPointY = 0;
    private _selectionStartX = 0;
    private _selectionStartY = 0;
    private _x = 0;
    private _y = 0;
    private _zoom = 1;
    private _selectedNodes: GraphNode[] = [];
    private _selectedLink: Nullable<NodeLink> = null;
    private _candidateLink: Nullable<NodeLink> = null;
    private _candidatePort: Nullable<NodePort> = null;
    private _gridSize = 20;
    private _selectionBox: Nullable<HTMLDivElement> = null;   
    private _selectedFrame: Nullable<GraphFrame> = null;   
    private _frameCandidate: Nullable<HTMLDivElement> = null;  

    private _frames: GraphFrame[] = [];

    private _altKeyIsPressed = false;
    private _ctrlKeyIsPressed = false;
    private _oldY = -1;

    public get gridSize() {
        return this._gridSize;
    }

    public set gridSize(value: number) {
        this._gridSize = value;
        
        this.updateTransform();
    }

    public get globalState(){
        return this.props.globalState;
    }

    public get nodes() {
        return this._nodes;
    }

    public get links() {
        return this._links;
    }

    public get frames() {
        return this._frames;
    }

    public get zoom() {
        return this._zoom;
    }

    public set zoom(value: number) {
        if (this._zoom === value) {
            return;
        }

        this._zoom = value;
        
        this.updateTransform();
    }    

    public get x() {
        return this._x;
    }

    public set x(value: number) {
        this._x = value;
        
        this.updateTransform();
    }

    public get y() {
        return this._y;
    }

    public set y(value: number) {
        this._y = value;
        
        this.updateTransform();
    }

    public get selectedNodes() {
        return this._selectedNodes;
    }

    public get selectedLink() {
        return this._selectedLink;
    }
    public get selectedFrame() {
        return this._selectedFrame;
    }

    public get canvasContainer() {
        return this._graphCanvas;
    }

    public get svgCanvas() {
        return this._svgCanvas;
    }

    public get selectionContainer() {
        return this._selectionContainer;
    }

    public get groupContainer() {
        return this._groupContainer;
    }
    

    constructor(props: IGraphCanvasComponentProps) {
        super(props);

        props.globalState.onSelectionChangedObservable.add(selection => {            
            if (!selection) {
                this._selectedNodes = [];
                this._selectedLink = null;
                this._selectedFrame = null;
            } else {
                if (selection instanceof NodeLink) {
                    this._selectedNodes = [];
                    this._selectedFrame = null;
                    this._selectedLink = selection;
                } else if (selection instanceof GraphFrame) {
                    this._selectedNodes = [];
                    this._selectedFrame = selection;
                    this._selectedLink = null;
                } else{
                    if (this._ctrlKeyIsPressed) {
                        if (this._selectedNodes.indexOf(selection) === -1) {
                            this._selectedNodes.push(selection);
                        }
                    } else {                    
                        this._selectedNodes = [selection];
                    }
                }
            }
        });

        props.globalState.onCandidatePortSelected.add(port => {
            this._candidatePort = port;
        });

        props.globalState.onGridSizeChanged.add(() => {
            this.gridSize = DataStorage.ReadNumber("GridSize", 20);
        });

        this.props.globalState.hostDocument!.addEventListener("keyup", () => this.onKeyUp(), false);
        this.props.globalState.hostDocument!.addEventListener("keydown", evt => {
            this._altKeyIsPressed = evt.altKey;            
            this._ctrlKeyIsPressed = evt.ctrlKey;
        }, false);
        this.props.globalState.hostDocument!.defaultView!.addEventListener("blur", () => {
            this._altKeyIsPressed = false;
            this._ctrlKeyIsPressed = false;
        }, false);     

        // Store additional data to serialization object
        this.props.globalState.storeEditorData = (editorData) => {
            editorData.zoom = this.zoom;
            editorData.x = this.x;
            editorData.y = this.y;

            editorData.frames = [];
            for (var frame of this._frames) {
                editorData.frames.push(frame.serialize());
            }
        }
    }

    public getGridPosition(position: number) {
        let gridSize = this.gridSize;
		if (gridSize === 0) {
			return position;
		}
		return gridSize * Math.floor(position / gridSize);
    }
    
    public getGridPositionCeil(position: number) {
        let gridSize = this.gridSize;
		if (gridSize === 0) {
			return position;
		}
		return gridSize * Math.ceil(position / gridSize);
	}

    updateTransform() {
        this._rootContainer.style.transform = `translate(${this._x}px, ${this._y}px) scale(${this._zoom})`;

        if (DataStorage.ReadBoolean("ShowGrid", true)) {
            this._hostCanvas.style.backgroundSize = `${this._gridSize * this._zoom}px ${this._gridSize * this._zoom}px`;
            this._hostCanvas.style.backgroundPosition = `${this._x}px ${this._y}px`;
        } else {
            this._hostCanvas.style.backgroundSize = `0`;
        }
    }

    onKeyUp() {        
        this._altKeyIsPressed = false;
        this._ctrlKeyIsPressed = false;
        this._oldY = -1;
    }

    findNodeFromBlock(block: NodeMaterialBlock) {
        return this.nodes.filter(n => n.block === block)[0];
    }

    reset() {
        for (var node of this._nodes) {
            node.dispose();
        }
        
        const frames = this._frames.splice(0);
        for (var frame of frames) {
            frame.dispose();
        }
        this._nodes = [];
        this._frames = [];
        this._links = [];
        this._graphCanvas.innerHTML = "";
        this._svgCanvas.innerHTML = "";
    }

    connectPorts(pointA: NodeMaterialConnectionPoint, pointB: NodeMaterialConnectionPoint) {
        var blockA = pointA.ownerBlock;
        var blockB = pointB.ownerBlock;
        var nodeA = this.findNodeFromBlock(blockA);
        var nodeB = this.findNodeFromBlock(blockB);

        if (!nodeA || !nodeB) {
            return;
        }

        var portA = nodeA.getPortForConnectionPoint(pointA);
        var portB = nodeB.getPortForConnectionPoint(pointB);

        if (!portA || !portB) {
            return;
        }

        for (var currentLink of this._links) {
            if (currentLink.portA === portA && currentLink.portB === portB) {
                return;
            }
            if (currentLink.portA === portB && currentLink.portB === portA) {
                return;
            }
        }

        const link = new NodeLink(this, portA, nodeA, portB, nodeB);
        this._links.push(link);

        nodeA.links.push(link);
        nodeB.links.push(link);
    }

    removeLink(link: NodeLink) {
        let index = this._links.indexOf(link);

        if (index > -1) {
            this._links.splice(index, 1);
        }

        link.dispose();
    }

    appendBlock(block: NodeMaterialBlock) {
        let newNode = new GraphNode(block, this.props.globalState);

        newNode.appendVisual(this._graphCanvas, this);

        this._nodes.push(newNode);

        return newNode;
    }

    distributeGraph() {
        this.x = 0;
        this.y = 0;
        this.zoom = 1;

        let graph = new dagre.graphlib.Graph();
        graph.setGraph({});
        graph.setDefaultEdgeLabel(() => ({}));
        graph.graph().rankdir = "LR";

        // Build dagre graph
        this._nodes.forEach(node => {
            graph.setNode(node.id.toString(), {
                id: node.id,
                width: node.width,
                height: node.height
            });
        });

        this._nodes.forEach(node => {
            node.block.outputs.forEach(output => {
                if (!output.hasEndpoints) {
                    return;
                }

                output.endpoints.forEach(endpoint => {
                    graph.setEdge(node.id.toString(), endpoint.ownerBlock.uniqueId.toString());
                });
            });
        });

        // Distribute
        dagre.layout(graph);

        // Update graph
        let dagreNodes = graph.nodes().map(node => graph.node(node));
        dagreNodes.forEach(dagreNode => {
            for (var node of this._nodes) {
                if (node.id === dagreNode.id) {
                    node.x = dagreNode.x - dagreNode.width / 2;
                    node.y = dagreNode.y - dagreNode.height / 2;
                    node.cleanAccumulation();
                    return;
                }
            }
        });        
    }

    componentDidMount() {
        this._hostCanvas = this.props.globalState.hostDocument.getElementById("graph-canvas") as HTMLDivElement;
        this._rootContainer = this.props.globalState.hostDocument.getElementById("graph-container") as HTMLDivElement;
        this._graphCanvas = this.props.globalState.hostDocument.getElementById("graph-canvas-container") as HTMLDivElement;
        this._svgCanvas = this.props.globalState.hostDocument.getElementById("graph-svg-container") as HTMLElement;        
        this._selectionContainer = this.props.globalState.hostDocument.getElementById("selection-container") as HTMLDivElement;   
        this._groupContainer = this.props.globalState.hostDocument.getElementById("group-container") as HTMLDivElement;        
        
        this.gridSize = DataStorage.ReadNumber("GridSize", 20);
        this.updateTransform();
    }    

    onMove(evt: React.PointerEvent) {        
        // Selection box
        if (this._selectionBox) {
            const rootRect = this.canvasContainer.getBoundingClientRect();      

            const localX = evt.pageX - rootRect.left;
            const localY = evt.pageY - rootRect.top;

            if (localX > this._selectionStartX) {
                this._selectionBox.style.left = `${this._selectionStartX / this.zoom}px`;
                this._selectionBox.style.width = `${(localX - this._selectionStartX) / this.zoom}px`;
            } else {
                this._selectionBox.style.left = `${localX / this.zoom}px`;
                this._selectionBox.style.width = `${(this._selectionStartX - localX) / this.zoom}px`;
            }

            if (localY > this._selectionStartY) {                
                this._selectionBox.style.top = `${this._selectionStartY / this.zoom}px`;
                this._selectionBox.style.height = `${(localY - this._selectionStartY) / this.zoom}px`;
            } else {
                this._selectionBox.style.top = `${localY / this.zoom}px`;
                this._selectionBox.style.height = `${(this._selectionStartY - localY) / this.zoom}px`;
            }
            
            this.props.globalState.onSelectionBoxMoved.notifyObservers(this._selectionBox.getBoundingClientRect());

            return;
        }

        // Candidate group box
        if (this._frameCandidate) {
            const rootRect = this.canvasContainer.getBoundingClientRect();      

            const localX = evt.pageX - rootRect.left;
            const localY = evt.pageY - rootRect.top;

            if (localX > this._selectionStartX) {
                this._frameCandidate.style.left = `${this._selectionStartX / this.zoom}px`;
                this._frameCandidate.style.width = `${(localX - this._selectionStartX) / this.zoom}px`;
            } else {
                this._frameCandidate.style.left = `${localX / this.zoom}px`;
                this._frameCandidate.style.width = `${(this._selectionStartX - localX) / this.zoom}px`;
            }

            if (localY > this._selectionStartY) {                
                this._frameCandidate.style.top = `${this._selectionStartY / this.zoom}px`;
                this._frameCandidate.style.height = `${(localY - this._selectionStartY) / this.zoom}px`;
            } else {
                this._frameCandidate.style.top = `${localY / this.zoom}px`;
                this._frameCandidate.style.height = `${(this._selectionStartY - localY) / this.zoom}px`;
            }

            return;
        }        

        // Candidate link
        if (this._candidateLink) {        
            const rootRect = this.canvasContainer.getBoundingClientRect();       
            this._candidatePort = null; 
            this.props.globalState.onCandidateLinkMoved.notifyObservers(new Vector2(evt.pageX, evt.pageY));
            this._dropPointX = (evt.pageX - rootRect.left) / this.zoom;
            this._dropPointY = (evt.pageY - rootRect.top) / this.zoom;

            this._candidateLink.update(this._dropPointX, this._dropPointY, true);
            
            return;
        }          

        // Zoom with mouse + alt
        if (this._altKeyIsPressed && evt.buttons === 1) {
            if (this._oldY < 0) {
                this._oldY = evt.pageY;
            }

            let zoomDelta = (evt.pageY - this._oldY) / 10;
            if (Math.abs(zoomDelta) > 5) {
                const oldZoom = this.zoom;
                this.zoom = Math.max(Math.min(this.MaxZoom, this.zoom + zoomDelta / 100), this.MinZoom);

                const boundingRect = evt.currentTarget.getBoundingClientRect();
                const clientWidth = boundingRect.width;
                const widthDiff = clientWidth * this.zoom - clientWidth * oldZoom;
                const clientX = evt.clientX - boundingRect.left;
        
                const xFactor = (clientX - this.x) / oldZoom / clientWidth;
        
                this.x = this.x - widthDiff * xFactor;

                this._oldY = evt.pageY;      
            }
            return;
        }   

        // Move canvas
        this._rootContainer.style.cursor = "move";

        if (this._mouseStartPointX === null || this._mouseStartPointY === null) {
            return;
        }
        this.x += evt.clientX - this._mouseStartPointX;
        this.y += evt.clientY - this._mouseStartPointY;

        this._mouseStartPointX = evt.clientX;
        this._mouseStartPointY = evt.clientY;
    }

    onDown(evt: React.PointerEvent<HTMLElement>) {
        this._rootContainer.setPointerCapture(evt.pointerId);

        // Selection?
        if (evt.currentTarget === this._hostCanvas && evt.ctrlKey) {
            this._selectionBox = this.props.globalState.hostDocument.createElement("div");
            this._selectionBox.classList.add("selection-box");
            this._selectionContainer.appendChild(this._selectionBox);

            const rootRect = this.canvasContainer.getBoundingClientRect();      
            this._selectionStartX = (evt.pageX - rootRect.left);
            this._selectionStartY = (evt.pageY - rootRect.top);
            this._selectionBox.style.left = `${this._selectionStartX / this.zoom}px`;
            this._selectionBox.style.top = `${this._selectionStartY / this.zoom}px`;
            this._selectionBox.style.width = "0px";
            this._selectionBox.style.height = "0px";
            return;
        }

        // Group?
        if (evt.currentTarget === this._hostCanvas && evt.shiftKey) {
            this._frameCandidate = this.props.globalState.hostDocument.createElement("div");
            this._frameCandidate.classList.add("group-box");
            this._groupContainer.appendChild(this._frameCandidate);

            const rootRect = this.canvasContainer.getBoundingClientRect();      
            this._selectionStartX = (evt.pageX - rootRect.left);
            this._selectionStartY = (evt.pageY - rootRect.top);
            this._frameCandidate.style.left = `${this._selectionStartX / this.zoom}px`;
            this._frameCandidate.style.top = `${this._selectionStartY / this.zoom}px`;
            this._frameCandidate.style.width = "0px";
            this._frameCandidate.style.height = "0px";
            return;
        }

        // Port dragging
        if (evt.nativeEvent.srcElement && (evt.nativeEvent.srcElement as HTMLElement).nodeName === "IMG") {
            if (!this._candidateLink) {
                let portElement = ((evt.nativeEvent.srcElement as HTMLElement).parentElement as any).port as NodePort;
                this._candidateLink = new NodeLink(this, portElement, portElement.node);
            }  
            return;
        }

        this.props.globalState.onSelectionChangedObservable.notifyObservers(null);
        this._mouseStartPointX = evt.clientX;
        this._mouseStartPointY = evt.clientY;        
    }

    onUp(evt: React.PointerEvent) {
        this._mouseStartPointX = null;
        this._mouseStartPointY = null;
        this._rootContainer.releasePointerCapture(evt.pointerId);   
        this._oldY = -1; 

        if (this._candidateLink) {        
            this.processCandidatePort();          
            this.props.globalState.onCandidateLinkMoved.notifyObservers(null);
            this._candidateLink.dispose();
            this._candidateLink = null;
            this._candidatePort = null;
        }

        if (this._selectionBox) {
           this._selectionBox.parentElement!.removeChild(this._selectionBox);
           this._selectionBox = null;
        }

        if (this._frameCandidate) {            
            let newGroup = new GraphFrame(this._frameCandidate, this);
            this._frames.push(newGroup);

            this._frameCandidate.parentElement!.removeChild(this._frameCandidate);
            this._frameCandidate = null;
         }
    }

    onWheel(evt: React.WheelEvent) {
        let delta = evt.deltaY < 0 ? 0.1 : -0.1;

        let oldZoom = this.zoom;
        this.zoom = Math.min(Math.max(this.MinZoom, this.zoom + delta * this.zoom), this.MaxZoom);

        const boundingRect = evt.currentTarget.getBoundingClientRect();
        const clientWidth = boundingRect.width;
        const clientHeight = boundingRect.height;
        const widthDiff = clientWidth * this.zoom - clientWidth * oldZoom;
        const heightDiff = clientHeight * this.zoom - clientHeight * oldZoom;
        const clientX = evt.clientX - boundingRect.left;
        const clientY = evt.clientY - boundingRect.top;

        const xFactor = (clientX - this.x) / oldZoom / clientWidth;
        const yFactor = (clientY - this.y) / oldZoom / clientHeight;

        this.x = this.x - widthDiff * xFactor;
        this.y = this.y - heightDiff * yFactor;

        evt.stopPropagation();
    }

    zoomToFit() {
        const xFactor = this._rootContainer.clientWidth / this._rootContainer.scrollWidth;
        const yFactor = this._rootContainer.clientHeight / this._rootContainer.scrollHeight;
        const zoomFactor = xFactor < yFactor ? xFactor : yFactor;
        
        this.zoom = zoomFactor;
        this.x = 0;
        this.y = 0;
    }

    processCandidatePort() {
        let pointB = this._candidateLink!.portA.connectionPoint;
        let nodeB = this._candidateLink!.portA.node;
        let pointA: NodeMaterialConnectionPoint;
        let nodeA: GraphNode;

        if (this._candidatePort) {
            pointA = this._candidatePort.connectionPoint;
            nodeA = this._candidatePort.node;
        } else {
            if (pointB.direction === NodeMaterialConnectionPointDirection.Output) {
                return;
            }

            // No destination so let's spin a new input block
            let inputBlock = new InputBlock("", undefined, this._candidateLink!.portA.connectionPoint.type);
            pointA = inputBlock.output;
            nodeA = this.appendBlock(inputBlock);
            
            nodeA.x = this._dropPointX - 200;
            nodeA.y = this._dropPointY - 50;    
        }

        if (pointA.direction === NodeMaterialConnectionPointDirection.Input) {
            let temp = pointB;
            pointB = pointA;
            pointA = temp;

            let tempNode = nodeA;
            nodeA = nodeB;
            nodeB = tempNode;
        }

        if (pointB.connectedPoint === pointA) {
            return;
        }

        if (pointB === pointA) {
            return;
        }

        if (pointB.direction === pointA.direction) {
            return;
        }

        // Check compatibility
        let isFragmentOutput = pointB.ownerBlock.getClassName() === "FragmentOutputBlock";
        let compatibilityState = pointA.checkCompatibilityState(pointB);
        if (compatibilityState === NodeMaterialConnectionPointCompatibilityStates.Compatible) {
            if (isFragmentOutput) {
                let fragmentBlock = pointB.ownerBlock as FragmentOutputBlock;

                if (pointB.name === "rgb" && fragmentBlock.rgba.isConnected) {
                    nodeB.getLinksForConnectionPoint(fragmentBlock.rgba)[0].dispose();
                } else if (pointB.name === "rgba" && fragmentBlock.rgb.isConnected) {
                    nodeB.getLinksForConnectionPoint(fragmentBlock.rgb)[0].dispose();
                }                     
            }
        } else {
            let message = "";

            switch (compatibilityState) {
                case NodeMaterialConnectionPointCompatibilityStates.TypeIncompatible:
                    message = "Cannot connect two different connection types";
                    break;
                case NodeMaterialConnectionPointCompatibilityStates.TargetIncompatible:
                    message = "Source block can only work in fragment shader whereas destination block is currently aimed for the vertex shader";
                    break;
            }

            this.props.globalState.onErrorMessageDialogRequiredObservable.notifyObservers(message);             
            return;
        }

        if (pointB.isConnected) {
            let links = nodeB.getLinksForConnectionPoint(pointB);

            links.forEach(link => {
                link.dispose();
            });
        }

        pointA.connectTo(pointB);
        this.connectPorts(pointA, pointB);

        nodeB.refresh();

        this.props.globalState.onRebuildRequiredObservable.notifyObservers();
    }

    processEditorData(editorData: IEditorData) {
        const frames = this._frames.splice(0);
        for (var frame of frames) {
            frame.dispose();
        }

        this._frames = [];

        this.x = editorData.x || 0;
        this.y = editorData.y || 0;
        this.zoom = editorData.zoom || 1;

        // Frames
        if (editorData.frames) {
            for (var frameData of editorData.frames) {
                var frame = GraphFrame.Parse(frameData, this);
                this._frames.push(frame);
            }
        }
    }
 
    render() {
        return (
            <div id="graph-canvas" 
                onWheel={evt => this.onWheel(evt)}
                onPointerMove={evt => this.onMove(evt)}
                onPointerDown={evt =>  this.onDown(evt)}   
                onPointerUp={evt =>  this.onUp(evt)} 
            >    
                <div id="graph-container">
                    <div id="graph-canvas-container">
                    </div>     
                    <div id="group-container">                        
                    </div>
                    <svg id="graph-svg-container">
                    </svg>                    
                    <div id="selection-container">                        
                    </div>
                </div>
            </div>
        );
    }
}
